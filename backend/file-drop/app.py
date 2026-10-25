#!/usr/bin/env python3
"""文件小站：密码登录后上传 / 下载 / 删除文件，全部路由挂在 /files 前缀下，
由前置代理按路径分流，与随手存共用同一个公网域名。
存储目录：默认本服务 files/；密码与会话密钥在 data/（不入日志）。
FILE_DROP_DATA_DIR 可指定独立运行根目录，其下仍使用 files/ 和 data/。"""
import hmac
import os
import secrets
import time
from collections import deque
from pathlib import Path

from flask import (Flask, abort, redirect, render_template, request,
                   send_file, session, url_for)

BASE = Path(__file__).resolve().parent
RUNTIME_ROOT = Path(os.environ.get("FILE_DROP_DATA_DIR", str(BASE))).expanduser().resolve()
FILES_DIR = RUNTIME_ROOT / "files"
DATA_DIR = RUNTIME_ROOT / "data"
FILES_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

PW_FILE = DATA_DIR / "password.txt"
if not PW_FILE.exists():
    PW_FILE.write_text(secrets.token_urlsafe(12), encoding="utf-8")
    PW_FILE.chmod(0o600)
PASSWORD = PW_FILE.read_text(encoding="utf-8").strip()

SECRET_FILE = DATA_DIR / "secret.txt"
if not SECRET_FILE.exists():
    SECRET_FILE.write_text(secrets.token_hex(32), encoding="utf-8")
    SECRET_FILE.chmod(0o600)

app = Flask(__name__, template_folder=str(BASE / "templates"))
app.secret_key = SECRET_FILE.read_text(encoding="utf-8").strip()
app.config["MAX_CONTENT_LENGTH"] = None  # 不设上限，受磁盘空间约束
app.permanent_session_lifetime = 60 * 60 * 24 * 30

attempts = deque()

def authed():
    return session.get("ok") is True


def human_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def sanitize(name):
    """保留中文等 Unicode 字符，只去掉路径分隔符和危险字符。"""
    name = name.replace("\\", "/").split("/")[-1]
    name = "".join(c for c in name if c not in '<>:"|?*' and ord(c) >= 32)
    name = name.strip().lstrip(".")
    return name or "file"


def safe_path(name):
    p = (FILES_DIR / name).resolve()
    if p.parent != FILES_DIR.resolve() or not p.is_file():
        abort(404)
    return p


@app.get("/files/")
def index():
    files = []
    if authed():
        for p in sorted(FILES_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if p.is_file():
                st = p.stat()
                files.append({
                    "name": p.name,
                    "size": human_size(st.st_size),
                    "time": time.strftime("%m-%d %H:%M", time.localtime(st.st_mtime)),
                })
    return render_template("index.html", authed=authed(), files=files, err=None)


@app.post("/files/login")
def login():
    now = time.time()
    while attempts and attempts[0] < now - 60:
        attempts.popleft()
    if len(attempts) >= 8:
        return render_template("index.html", authed=False, files=[], err="尝试次数过多，请 1 分钟后重试"), 429
    supplied = request.form.get("password", "")
    if hmac.compare_digest(supplied, PASSWORD):
        session.permanent = True
        session["ok"] = True
        return redirect(url_for("index"))
    attempts.append(now)
    return render_template("index.html", authed=False, files=[], err="密码不对"), 401


@app.post("/files/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.post("/files/upload")
def upload():
    if not authed():
        return redirect(url_for("index"))
    for f in request.files.getlist("files"):
        if not f or not f.filename:
            continue
        name = sanitize(f.filename)
        target = FILES_DIR / name
        if target.exists():
            stem, dot, ext = name.rpartition(".")
            i = 1
            while True:
                cand = f"{stem} ({i}).{ext}" if dot else f"{name} ({i})"
                target = FILES_DIR / cand
                if not target.exists():
                    break
                i += 1
        f.save(target)
    return redirect(url_for("index"))


@app.get("/files/download/<path:name>")
def download(name):
    if not authed():
        return redirect(url_for("index"))
    return send_file(safe_path(name), as_attachment=True, download_name=name)


@app.post("/files/delete/<path:name>")
def delete(name):
    if not authed():
        return redirect(url_for("index"))
    safe_path(name).unlink()
    return redirect(url_for("index"))


if __name__ == "__main__":
    from waitress import serve

    port = int(os.environ.get("FILE_DROP_PORT", "7864"))
    print(f"file-drop on http://127.0.0.1:{port}/files/", flush=True)
    serve(app, host="127.0.0.1", port=port, threads=8)
