#!/usr/bin/env python3
"""文件小站：密码登录后上传 / 下载 / 删除文件，全部路由挂在 /files 前缀下，
由前置代理按路径分流，与随手存共用同一个公网域名。
存储目录：本服务 files/；密码与会话密钥在 data/（不入日志）。"""
import hmac
import os
import secrets
import time
from collections import deque
from pathlib import Path

from flask import (Flask, abort, redirect, render_template_string, request,
                   send_file, session, url_for)

BASE = Path(__file__).resolve().parent
FILES_DIR = BASE / "files"
DATA_DIR = BASE / "data"
FILES_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

PW_FILE = DATA_DIR / "password.txt"
if not PW_FILE.exists():
    PW_FILE.write_text(secrets.token_urlsafe(12), encoding="utf-8")
    PW_FILE.chmod(0o600)
PASSWORD = PW_FILE.read_text(encoding="utf-8").strip()

SECRET_FILE = DATA_DIR / "secret.txt"
if not SECRET_FILE.exists():
    SECRET_FILE.write_text(secrets.token_hex(32), encoding="utf-8")
    SECRET_FILE.chmod(0o600)

app = Flask(__name__)
app.secret_key = SECRET_FILE.read_text(encoding="utf-8").strip()
app.config["MAX_CONTENT_LENGTH"] = None  # 不设上限，受磁盘空间约束
app.permanent_session_lifetime = 60 * 60 * 24 * 30

attempts = deque()

PAGE = """<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#faf9f6">
<title>文件小站 · 陈玉庆</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700;900&display=swap" rel="stylesheet">
<style>
:root{--paper:#faf9f6;--ink:#1b1815;--ink2:#45403a;--muted:#8a8177;--line:#e6e1d8;--accent:#b3402a;--accent-dark:#97351f;--serif:"Noto Serif SC","Songti SC","STSong",serif}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased}
::selection{background:var(--accent);color:#fff}
main{max-width:680px;margin:0 auto;padding:26px 18px 56px}
.nav{display:flex;gap:10px;flex-wrap:wrap;margin:2px 0 20px}
.nav a{font-size:13px;color:var(--ink2);text-decoration:none;background:#fff;border:1px solid var(--line);padding:7px 14px;border-radius:999px;transition:border-color .2s,color .2s}
.nav a:hover{border-color:var(--accent);color:var(--accent)}
.kicker{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--accent);margin:0 0 10px}
h1{font-family:var(--serif);font-size:27px;font-weight:900;margin:0 0 18px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 1px 2px rgba(27,24,21,.03)}
input[type=password]{width:100%;padding:12px 14px;border:1px solid #ddd6c9;border-radius:9px;font-size:16px;outline:0;transition:border-color .15s,box-shadow .15s}
input[type=password]:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(179,64,42,.12)}
input[type=file]{width:100%;font-size:14.5px;color:var(--ink2)}
button{background:var(--accent);color:#fff;border:0;border-radius:9px;padding:11px 18px;font-size:15px;cursor:pointer;transition:background .15s}
button:hover{background:var(--accent-dark)}
button.ghost{background:#fff;color:var(--ink2);border:1px solid var(--line);font-size:13px;padding:7px 14px;border-radius:999px}
button.ghost:hover{border-color:var(--accent);color:var(--accent);background:#fff}
.err{color:var(--accent);margin:10px 0 0;font-size:13.5px}
table{width:100%;border-collapse:collapse;font-size:14px}
tr{transition:background .15s}
tbody tr:hover{background:#fffdf9}
td{padding:11px 4px;border-bottom:1px solid #f0ebdf;vertical-align:middle}
tr:last-child td{border-bottom:none}
td.size,td.time{color:var(--muted);white-space:nowrap;font-size:12px}
td.act{white-space:nowrap;text-align:right}
a.dl{color:var(--accent);text-decoration:none;margin-right:12px;font-size:13.5px}
a.dl:hover{text-decoration:underline}
form.inline{display:inline}
button.del{background:none;color:#b09a8d;padding:4px 6px;font-size:13px}
button.del:hover{background:none;color:var(--accent)}
.empty{color:var(--muted);text-align:center;padding:22px;font-size:14px}
.top{display:flex;justify-content:space-between;align-items:center}
.top h1{margin:0 0 18px}
</style></head><body><main>
<p class="nav"><a href="/">← 回到博客</a><a href="/douyin">随手存 · 视频下载</a></p>
{% if not authed %}
<p class="kicker">File Drop</p>
<h1>文件小站</h1>
<div class="card">
<form method="post" action="{{ url_for('login') }}">
<input type="password" name="password" placeholder="访问密码" autofocus required>
{% if err %}<p class="err">{{ err }}</p>{% endif %}
<p><button type="submit" style="width:100%">登录</button></p>
</form></div>
{% else %}
<div class="top"><h1>文件小站</h1>
<form method="post" action="{{ url_for('logout') }}"><button class="ghost">退出</button></form></div>
<div class="card">
<form method="post" action="{{ url_for('upload') }}" enctype="multipart/form-data">
<p><input type="file" name="files" multiple required></p>
<p><button type="submit" style="width:100%">上传</button></p>
</form></div>
<div class="card">
{% if files %}
<table>
{% for f in files %}
<tr>
<td>{{ f.name }}</td>
<td class="size">{{ f.size }}</td>
<td class="time">{{ f.time }}</td>
<td class="act"><a class="dl" href="{{ url_for('download', name=f.name) }}">下载</a><form class="inline" method="post" action="{{ url_for('delete', name=f.name) }}" onsubmit="return confirm('删除 {{ f.name }}？')"><button class="del" type="submit">删除</button></form></td>
</tr>
{% endfor %}
</table>
{% else %}
<p class="empty">还没有文件，先上传一个吧</p>
{% endif %}
</div>
{% endif %}
</main></body></html>"""


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
    return render_template_string(PAGE, authed=authed(), files=files, err=None)


@app.post("/files/login")
def login():
    now = time.time()
    while attempts and attempts[0] < now - 60:
        attempts.popleft()
    if len(attempts) >= 8:
        return render_template_string(PAGE, authed=False, files=[], err="尝试次数过多，请 1 分钟后重试"), 429
    supplied = request.form.get("password", "")
    if hmac.compare_digest(supplied, PASSWORD):
        session.permanent = True
        session["ok"] = True
        return redirect(url_for("index"))
    attempts.append(now)
    return render_template_string(PAGE, authed=False, files=[], err="密码不对"), 401


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
