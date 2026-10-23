#!/usr/bin/env python3
"""微信 ClawBot(iLink Bot 协议) <-> Muse 桥接程序。

实现依据（2026-10-21 读取的现行文档与源码）：
- 协议文档 docs/protocol_zh_CN.md（仓库 tencent/openclaw-weixin）
- 插件源码 src/api/api.ts、src/auth/login-qr.ts；插件版本 2.4.10
- channel_version = "2.4.10"，iLink-App-ClientVersion 按 0x00MMNNPP
  编码 = 132106，iLink-App-Id = "bot"

子命令：
  login         获取登录二维码（图片存 state/qrcode.png，内容存 pending）
  wait-login    轮询扫码状态；confirmed 后原子保存 state/session.json
  serve         长轮询收消息 -> inbox/；发送 outbox/ 中的回复
  send TEXT     以机器人身份主动给绑定用户发一条文本（入 outbox 队列）
  reply ID FILE 把 FILE 的文本作为对收件消息 ID 的回复入 outbox 队列
  claim         原子认领 inbox/new 中的消息（执行者用），打印认领结果
  done ID       标记消息处理完成（已回复或已说明失败）
  requeue-stale 把卡在 processing 超过 20 分钟的消息放回 new
  status        打印脱敏状态

凭据只存 state/session.json（0600），日志与状态输出一律脱敏。
"""
from __future__ import annotations

import base64
import json
import os
import signal
import struct
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

BASE = Path(__file__).parent
STATE = BASE / "state"
INBOX_NEW = BASE / "inbox" / "new"
INBOX_PROC = BASE / "inbox" / "processing"
INBOX_DONE = BASE / "inbox" / "done"
OUTBOX_PENDING = BASE / "outbox" / "pending"
OUTBOX_SENT = BASE / "outbox" / "sent"
OUTBOX_FAILED = BASE / "outbox" / "failed"
LOGS = BASE / "logs"
for d in (STATE, INBOX_NEW, INBOX_PROC, INBOX_DONE, OUTBOX_PENDING, OUTBOX_SENT, OUTBOX_FAILED, LOGS):
    d.mkdir(parents=True, exist_ok=True)

FIXED_BASE = "https://ilinkai.weixin.qq.com"
BOT_TYPE = "3"
CHANNEL_VERSION = "2.4.10"
_parts = [int(x) for x in CHANNEL_VERSION.split(".")]
CLIENT_VERSION = str((_parts[0] << 16) | (_parts[1] << 8) | _parts[2])
APP_ID = "bot"
BOT_AGENT = "MuseBridge/1.0"
SESSION_FILE = STATE / "session.json"
CURSOR_FILE = STATE / "cursor.txt"
CONTEXTS_FILE = STATE / "contexts.json"
PENDING_LOGIN = STATE / "login_pending.json"
LOCK_FILE = STATE / "serve.lock"
PAUSE_FILE = STATE / "session_paused.json"
LOG_FILE = LOGS / "bridge.log"
MAX_SEND_ATTEMPTS = 3

_stop = threading.Event()


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    try:
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass
    print(line, flush=True)


def mask(s: str | None, keep: int = 4) -> str:
    if not s:
        return "-"
    return s[:keep] + "***" if len(s) > keep else "***"


def atomic_write(path: Path, text: str, mode: int | None = None) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    if mode is not None:
        os.chmod(tmp, mode)
    os.replace(tmp, path)


def base_info() -> dict:
    return {"channel_version": CHANNEL_VERSION, "bot_agent": BOT_AGENT}


def wechat_uin() -> str:
    return base64.b64encode(str(struct.unpack(">I", os.urandom(4))[0]).encode()).decode()


def app_headers() -> dict:
    return {"iLink-App-Id": APP_ID, "iLink-App-ClientVersion": CLIENT_VERSION}


def http_json(method: str, url: str, body: dict | None, headers: dict, timeout: float) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace") if e.fp else ""
        try:
            parsed = json.loads(raw) if raw.strip() else {}
        except ValueError:
            parsed = {"raw": raw[:200]}
        return e.code, parsed


def load_session() -> dict | None:
    if not SESSION_FILE.exists():
        return None
    try:
        return json.loads(SESSION_FILE.read_text("utf-8"))
    except ValueError:
        return None


def bot_headers(session: dict) -> dict:
    h = app_headers()
    h.update({
        "Content-Type": "application/json",
        "AuthorizationType": "ilink_bot_token",
        "Authorization": f"Bearer {session['bot_token']}",
        "X-WECHAT-UIN": wechat_uin(),
    })
    return h


def bot_post(session: dict, path: str, body: dict, timeout: float) -> tuple[int, dict]:
    body = {**body, "base_info": base_info()}
    base = session.get("baseurl") or FIXED_BASE
    return http_json("POST", f"{base}{path}", body, bot_headers(session), timeout)


# ---------------------------------------------------------------- login

def cmd_login() -> int:
    session = load_session()
    local_tokens = [session["bot_token"]] if session and session.get("bot_token") else []
    headers = app_headers()
    headers.update({
        "Content-Type": "application/json",
        "AuthorizationType": "ilink_bot_token",
        "X-WECHAT-UIN": wechat_uin(),
    })
    status, resp = http_json(
        "POST", f"{FIXED_BASE}/ilink/bot/get_bot_qrcode?bot_type={BOT_TYPE}",
        {"local_token_list": local_tokens}, headers, 30)
    if status != 200 or not resp.get("qrcode"):
        print(f"LOGIN_FAILED http={status} resp={ {k: v for k, v in resp.items() if 'token' not in k} }")
        return 1
    qrcode_value = resp["qrcode"]
    img_content = resp.get("qrcode_img_content") or ""
    atomic_write(PENDING_LOGIN, json.dumps({
        "qrcode": qrcode_value, "qrcode_img_content": img_content,
        "base": FIXED_BASE, "started_at": time.time(),
    }, ensure_ascii=False))
    # 渲染二维码图片：内容为 qrcode_img_content（服务端给出的展示 URL）
    png = STATE / "qrcode.png"
    try:
        import qrcode as qr_lib
        img = qr_lib.make(img_content or qrcode_value)
        img.save(png)
        print(f"QRCODE_PNG {png}")
    except Exception as e:
        print(f"QRCODE_PNG_FAILED {e}")
    print(f"QRCODE_CONTENT {img_content}")
    log("login: 二维码已生成，等待扫码")
    return 0


def cmd_wait_login(timeout_s: int = 300) -> int:
    if not PENDING_LOGIN.exists():
        print("NO_PENDING_LOGIN")
        return 1
    pending = json.loads(PENDING_LOGIN.read_text("utf-8"))
    qrcode_value = pending["qrcode"]
    base = pending.get("base") or FIXED_BASE
    deadline = time.time() + timeout_s
    verify_code = None
    while time.time() < deadline:
        url = f"{base}/ilink/bot/get_qrcode_status?qrcode={urllib.parse.quote(qrcode_value)}"
        if verify_code:
            url += f"&verify_code={urllib.parse.quote(verify_code)}"
        try:
            status, resp = http_json("GET", url, None, app_headers(), 40)
            if status != 200:
                log(f"wait-login: http={status}，继续等待")
                time.sleep(2)
                continue
        except Exception as e:
            log(f"wait-login: 网络异常 {type(e).__name__}，继续等待")
            time.sleep(2)
            continue
        st = resp.get("status", "wait")
        if st in ("wait",):
            continue
        if st == "scaned":
            log("wait-login: 已扫码，等待确认")
            continue
        if st == "scaned_but_redirect":
            host = resp.get("redirect_host")
            if host:
                base = host if host.startswith("http") else f"https://{host}"
                log(f"wait-login: 服务端重定向，切换轮询地址 host={urllib.parse.urlparse(base).hostname}")
            continue
        if st == "need_verifycode":
            code_file = STATE / "verify_code.txt"
            print("NEED_VERIFYCODE 请把微信页面上显示的验证码写入 state/verify_code.txt，或用 wait-login --code 重跑", flush=True)
            log("wait-login: 需要验证码，等待提供")
            got = None
            while time.time() < deadline:
                if code_file.exists():
                    got = code_file.read_text("utf-8").strip()
                    code_file.unlink(missing_ok=True)
                    break
                time.sleep(2)
            if not got:
                print("VERIFYCODE_TIMEOUT")
                return 1
            verify_code = got
            continue
        if st == "verify_code_blocked":
            print("VERIFY_CODE_BLOCKED 验证码错误次数过多，请重新 login")
            return 1
        if st == "expired":
            print("QRCODE_EXPIRED")
            return 2
        if st == "binded_redirect":
            print("BINDED_REDIRECT 该 Bot 已绑定到现有实例")
            log("wait-login: binded_redirect")
            return 3
        if st == "confirmed":
            if not resp.get("bot_token"):
                print("CONFIRMED_WITHOUT_TOKEN 响应缺少 bot_token")
                return 1
            session = {
                "bot_token": resp["bot_token"],
                "ilink_bot_id": resp.get("ilink_bot_id", ""),
                "ilink_user_id": resp.get("ilink_user_id", ""),
                "baseurl": resp.get("baseurl") or FIXED_BASE,
                "saved_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            atomic_write(SESSION_FILE, json.dumps(session, ensure_ascii=False, indent=2), mode=0o600)
            PENDING_LOGIN.unlink(missing_ok=True)
            log(f"wait-login: 登录成功 bot={mask(session['ilink_bot_id'])} user={mask(session['ilink_user_id'])} base={session['baseurl']}")
            print("LOGIN_CONFIRMED")
            return 0
        log(f"wait-login: 未知状态 {st}，继续等待")
        time.sleep(1)
    print("WAIT_LOGIN_TIMEOUT")
    return 1


# ---------------------------------------------------------------- serve

def load_contexts() -> dict:
    if CONTEXTS_FILE.exists():
        try:
            return json.loads(CONTEXTS_FILE.read_text("utf-8"))
        except ValueError:
            return {}
    return {}


def extract_items(msg: dict) -> tuple[str, str, list[int]]:
    """返回 (kind, text, media_types)。kind: text / voice_text / unsupported"""
    texts, media = [], []
    for item in msg.get("item_list") or []:
        t = item.get("type")
        if t == 1:
            txt = ((item.get("text_item") or {}).get("text") or "").strip()
            if txt:
                texts.append(txt)
        elif t == 3:
            vtxt = ((item.get("voice_item") or {}).get("text") or "").strip()
            if vtxt:
                texts.append(vtxt)
            else:
                media.append(3)
        elif t in (2, 4, 5):
            media.append(t)
        else:
            media.append(t or -1)
    if texts:
        return ("voice_text" if media == [] and any(
            (i.get("type") == 3) for i in msg.get("item_list") or []) else "text",
            "\n".join(texts), media)
    return ("unsupported", "", media)


def updates_loop(session: dict) -> None:
    cursor = CURSOR_FILE.read_text("utf-8").strip() if CURSOR_FILE.exists() else ""
    backoff = 5
    while not _stop.is_set():
        # 会话暂停（ret/errcode -14）：按协议暂停 1 小时，不误判为凭据过期
        if PAUSE_FILE.exists():
            try:
                paused_until = json.loads(PAUSE_FILE.read_text("utf-8")).get("until", 0)
            except ValueError:
                paused_until = 0
            if time.time() < paused_until:
                if _stop.wait(30):
                    break
                continue
            PAUSE_FILE.unlink(missing_ok=True)
            log("getupdates: 会话暂停结束，恢复轮询")
        try:
            status, resp = bot_post(session, "/ilink/bot/getupdates",
                                    {"get_updates_buf": cursor}, timeout=45)
        except Exception as e:
            log(f"getupdates: 网络失败 {type(e).__name__}，{backoff}s 后重试")
            _stop.wait(backoff)
            backoff = min(backoff * 2, 60)
            continue
        if status != 200:
            log(f"getupdates: HTTP {status}，{backoff}s 后重试")
            _stop.wait(backoff)
            backoff = min(backoff * 2, 60)
            continue
        backoff = 5
        ret = resp.get("ret", 0)
        errcode = resp.get("errcode", 0)
        if ret not in (0, None) or errcode not in (0, None):
            code = errcode if errcode else ret
            if code == -14:
                until = time.time() + 3600
                atomic_write(PAUSE_FILE, json.dumps({"until": until, "code": -14,
                                                     "at": time.strftime("%Y-%m-%d %H:%M:%S")}))
                log("getupdates: 收到 -14，账号会话暂停 1 小时（非凭据过期）")
                continue
            log(f"getupdates: 业务错误 ret={ret} errcode={errcode} errmsg={resp.get('errmsg', '')}，退避重试")
            _stop.wait(10)
            continue
        for msg in resp.get("msgs") or []:
            handle_incoming(session, msg)
        new_cursor = resp.get("get_updates_buf")
        if new_cursor:
            cursor = new_cursor
            atomic_write(CURSOR_FILE, cursor)


def handle_incoming(session: dict, msg: dict) -> None:
    mid = str(msg.get("message_id") or "")
    if not mid:
        return
    bound_user = session.get("ilink_user_id", "")
    sender = msg.get("from_user_id", "")
    if msg.get("group_id"):
        log(f"incoming: 忽略群消息 id={mid}")
        return
    if bound_user and sender != bound_user:
        log(f"incoming: 忽略非绑定用户消息 id={mid} from={mask(sender)}")
        return
    if msg.get("message_type") not in (1, None):
        return
    # 去重：任一收件箱目录已有同 ID 文件即跳过
    for d in (INBOX_NEW, INBOX_PROC, INBOX_DONE):
        if (d / f"{mid}.json").exists():
            return
    kind, text, media = extract_items(msg)
    record = {
        "message_id": mid, "seq": msg.get("seq"),
        "from_user_id": sender, "session_id": msg.get("session_id", ""),
        "context_token": msg.get("context_token", ""),
        "kind": kind, "text": text, "media_types": media,
        "create_time_ms": msg.get("create_time_ms"),
        "received_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "status": "received",
    }
    atomic_write(INBOX_NEW / f"{mid}.json", json.dumps(record, ensure_ascii=False, indent=2))
    contexts = load_contexts()
    contexts[sender] = {"context_token": record["context_token"],
                        "session_id": record["session_id"],
                        "updated_at": record["received_at"]}
    atomic_write(CONTEXTS_FILE, json.dumps(contexts, ensure_ascii=False, indent=2))
    log(f"incoming: 已保存 id={mid} kind={kind} len={len(text)}")


def send_one(session: dict, out_path: Path) -> bool:
    data = json.loads(out_path.read_text("utf-8"))
    msg_body = {
        "msg": {
            "from_user_id": "",
            "to_user_id": data["to_user_id"],
            "client_id": data.get("client_id") or uuid.uuid4().hex,
            "message_type": 2,
            "message_state": 2,
            "context_token": data.get("context_token", ""),
            "item_list": [{"type": 1, "text_item": {"text": data["text"]}}],
        }
    }
    data["client_id"] = msg_body["msg"]["client_id"]
    try:
        status, resp = bot_post(session, "/ilink/bot/sendmessage", msg_body, timeout=30)
    except Exception as e:
        data["attempts"] = data.get("attempts", 0) + 1
        data["last_error"] = f"network:{type(e).__name__}"
        atomic_write(out_path, json.dumps(data, ensure_ascii=False, indent=2))
        log(f"send: 网络失败 id={data.get('id')} attempts={data['attempts']}")
        return False
    if status == 200 and resp.get("ret", 0) == 0:
        data["status"] = "sent"
        data["sent_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        atomic_write(OUTBOX_SENT / out_path.name, json.dumps(data, ensure_ascii=False, indent=2))
        out_path.unlink(missing_ok=True)
        log(f"send: 成功 id={data.get('id')} reply_to={data.get('reply_to', '-')}")
        return True
    data["attempts"] = data.get("attempts", 0) + 1
    data["last_error"] = f"http={status} ret={resp.get('ret')} errmsg={resp.get('errmsg', '')}"
    if data["attempts"] >= MAX_SEND_ATTEMPTS:
        data["status"] = "failed"
        atomic_write(OUTBOX_FAILED / out_path.name, json.dumps(data, ensure_ascii=False, indent=2))
        out_path.unlink(missing_ok=True)
        log(f"send: 业务错误重试耗尽 id={data.get('id')} {data['last_error']}")
    else:
        atomic_write(out_path, json.dumps(data, ensure_ascii=False, indent=2))
        log(f"send: 业务错误 id={data.get('id')} {data['last_error']}，将重试")
    return False


def sender_loop(session: dict) -> None:
    while not _stop.is_set():
        try:
            pend = sorted(OUTBOX_PENDING.glob("*.json"), key=lambda p: p.stat().st_mtime)
            for p in pend:
                if _stop.is_set():
                    break
                send_one(session, p)
        except Exception as e:
            log(f"sender: 异常 {type(e).__name__}: {e}")
        _stop.wait(2)


def cmd_serve() -> int:
    session = load_session()
    if not session:
        print("NO_SESSION 请先 login 并完成扫码")
        return 1
    if LOCK_FILE.exists():
        try:
            pid = int(LOCK_FILE.read_text().strip())
            os.kill(pid, 0)
            print(f"ALREADY_RUNNING pid={pid}")
            return 1
        except (ValueError, ProcessLookupError):
            LOCK_FILE.unlink(missing_ok=True)
    LOCK_FILE.write_text(str(os.getpid()))
    def _sig(*_a):
        _stop.set()
    signal.signal(signal.SIGTERM, _sig)
    signal.signal(signal.SIGINT, _sig)
    log(f"serve: 启动 bot={mask(session.get('ilink_bot_id'))} base={session.get('baseurl')}")
    try:
        bot_post(session, "/ilink/bot/msg/notifystart", {}, timeout=15)
    except Exception:
        log("serve: notifyStart 发送失败（不阻断启动）")
    t = threading.Thread(target=updates_loop, args=(session,), daemon=True)
    t.start()
    try:
        sender_loop(session)
    finally:
        _stop.set()
        try:
            bot_post(session, "/ilink/bot/msg/notifystop", {}, timeout=10)
        except Exception:
            pass
        LOCK_FILE.unlink(missing_ok=True)
        log("serve: 已退出")
    return 0


# ---------------------------------------------------------------- outbox / worker

def enqueue(to_user_id: str, context_token: str, text: str, reply_to: str = "") -> str:
    oid = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    record = {
        "id": oid, "to_user_id": to_user_id, "context_token": context_token,
        "text": text, "reply_to": reply_to, "status": "pending",
        "attempts": 0, "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "client_id": uuid.uuid4().hex,
    }
    atomic_write(OUTBOX_PENDING / f"{oid}.json", json.dumps(record, ensure_ascii=False, indent=2))
    return oid


def cmd_send(text: str) -> int:
    session = load_session()
    if not session:
        print("NO_SESSION")
        return 1
    contexts = load_contexts()
    uid = session.get("ilink_user_id", "")
    ctx = (contexts.get(uid) or {}).get("context_token", "")
    if not ctx:
        print("NO_CONTEXT 尚无该用户的会话上下文，先让用户在微信发一条消息")
        return 1
    oid = enqueue(uid, ctx, text)
    print(f"QUEUED {oid}")
    return 0


def cmd_claim() -> int:
    claimed = []
    for p in sorted(INBOX_NEW.glob("*.json"), key=lambda p: p.stat().st_mtime):
        target = INBOX_PROC / p.name
        try:
            os.rename(p, target)  # 原子认领，避免重复执行
        except FileNotFoundError:
            continue
        data = json.loads(target.read_text("utf-8"))
        data["status"] = "executing"
        data["claimed_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        atomic_write(target, json.dumps(data, ensure_ascii=False, indent=2))
        claimed.append(data)
    print(json.dumps(claimed, ensure_ascii=False))
    return 0


def cmd_reply(mid: str, text_file: str) -> int:
    proc = INBOX_PROC / f"{mid}.json"
    done = INBOX_DONE / f"{mid}.json"
    src = proc if proc.exists() else done
    if not src.exists():
        print(f"MSG_NOT_FOUND {mid}")
        return 1
    data = json.loads(src.read_text("utf-8"))
    text = Path(text_file).read_text("utf-8") if text_file != "-" else sys.stdin.read()
    oid = enqueue(data["from_user_id"], data.get("context_token", ""), text, reply_to=mid)
    data["status"] = "replied"
    data["reply_outbox_id"] = oid
    atomic_write(src, json.dumps(data, ensure_ascii=False, indent=2))
    print(f"REPLY_QUEUED {oid}")
    return 0


def cmd_done(mid: str, note: str = "") -> int:
    proc = INBOX_PROC / f"{mid}.json"
    if not proc.exists():
        print(f"NOT_IN_PROCESSING {mid}")
        return 1
    data = json.loads(proc.read_text("utf-8"))
    if data.get("status") == "replied":
        data["status"] = "done"
    else:
        data["status"] = "done_no_reply"
    if note:
        data["done_note"] = note
    data["done_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    atomic_write(INBOX_DONE / proc.name, json.dumps(data, ensure_ascii=False, indent=2))
    proc.unlink(missing_ok=True)
    print("DONE")
    return 0


def cmd_requeue_stale() -> int:
    moved = 0
    cutoff = time.time() - 20 * 60
    for p in INBOX_PROC.glob("*.json"):
        if p.stat().st_mtime < cutoff:
            os.rename(p, INBOX_NEW / p.name)
            moved += 1
    print(f"REQUEUED {moved}")
    return 0


def cmd_status() -> int:
    session = load_session()
    out = {"logged_in": bool(session)}
    if session:
        out["bot_id"] = mask(session.get("ilink_bot_id"))
        out["user_id"] = mask(session.get("ilink_user_id"))
        out["baseurl"] = session.get("baseurl")
        out["session_saved_at"] = session.get("saved_at")
    alive = False
    if LOCK_FILE.exists():
        try:
            pid = int(LOCK_FILE.read_text().strip())
            os.kill(pid, 0)
            alive = True
            out["serve_pid"] = pid
        except (ValueError, ProcessLookupError):
            alive = False
    out["serve_running"] = alive
    out["cursor_saved"] = CURSOR_FILE.exists() and bool(CURSOR_FILE.read_text("utf-8").strip())
    out["inbox"] = {"new": len(list(INBOX_NEW.glob('*.json'))),
                    "processing": len(list(INBOX_PROC.glob('*.json'))),
                    "done": len(list(INBOX_DONE.glob('*.json')))}
    out["outbox"] = {"pending": len(list(OUTBOX_PENDING.glob('*.json'))),
                     "sent": len(list(OUTBOX_SENT.glob('*.json'))),
                     "failed": len(list(OUTBOX_FAILED.glob('*.json')))}
    if PAUSE_FILE.exists():
        out["session_paused"] = json.loads(PAUSE_FILE.read_text("utf-8"))
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 0
    cmd = args[0]
    if cmd == "login":
        return cmd_login()
    if cmd == "wait-login":
        timeout = 300
        if "--timeout" in args:
            timeout = int(args[args.index("--timeout") + 1])
        return cmd_wait_login(timeout)
    if cmd == "serve":
        return cmd_serve()
    if cmd == "send":
        return cmd_send(" ".join(args[1:]))
    if cmd == "claim":
        return cmd_claim()
    if cmd == "reply":
        return cmd_reply(args[1], args[2])
    if cmd == "done":
        return cmd_done(args[1], " ".join(args[2:]))
    if cmd == "requeue-stale":
        return cmd_requeue_stale()
    if cmd == "status":
        return cmd_status()
    print(f"unknown command: {cmd}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
