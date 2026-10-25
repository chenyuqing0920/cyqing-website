"""Password protected mobile interface. Only loopback is exposed to the tunnel."""
from __future__ import annotations

import hashlib
import hmac
import json
import queue
import secrets
import threading
import time
from collections import deque
from functools import wraps
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, render_template, request, stream_with_context
from urllib.parse import urlsplit
import urllib.request
from werkzeug.security import check_password_hash, generate_password_hash

from downloader import DATA, Cancelled, DownloadError, Resolver, extract_any_links, safe_name

class LinkExpired(DownloadError):
    pass


def direct_links(info):
    urls = []
    for url in info.urls:
        try:
            value = urlsplit(url)
            if value.scheme == "https" and value.hostname and not value.username and not value.password and value.port in (None, 443) and url not in urls:
                urls.append(url)
        except ValueError:
            continue
    return urls[:16]


def load_access(data_dir=DATA):
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / "remote-access.json"
    if path.exists():
        return json.loads(path.read_text("utf-8"))
    value = {"password": secrets.token_urlsafe(15)}
    # This local file is read by the PC control panel only, never served by HTTP.
    with path.open("x", encoding="utf-8") as f:
        json.dump(value, f)
    return value


class Jobs:
    def __init__(self, resolver_factory=Resolver, on_log=None, log_file=None):
        self.resolver_factory = resolver_factory
        self.on_log = on_log or (lambda _: None)
        self.lock = threading.RLock()
        self.queue = queue.Queue()
        self.items = {}
        self.stopping = threading.Event()
        self.active_cancel = None
        self.browser_lock = threading.Lock()
        # Viewable run log: an in-memory ring buffer mirrored to a file in
        # the data directory, so parse stages and failures can be read from
        # the web UI (/api/logs) instead of only from the server's stdout.
        self._log_lock = threading.Lock()
        self._log_lines = deque(maxlen=500)
        self._log_file = Path(log_file) if log_file else DATA / "resolver.log"
        self._load_log_tail()
        self.worker = threading.Thread(target=self.run, daemon=True)
        self.worker.start()

    def _load_log_tail(self):
        try:
            if self._log_file.stat().st_size > 2_000_000:
                self._log_file.replace(self._log_file.with_suffix(".log.1"))
            if self._log_file.exists():
                tail = self._log_file.read_text("utf-8", "replace").splitlines()[-200:]
                self._log_lines.extend(tail)
        except OSError:
            pass

    def emit(self, text):
        """Record one timestamped line in the log buffer + file, then hand
        it to the console callback as before."""
        line = time.strftime("%Y-%m-%d %H:%M:%S") + " " + str(text)
        with self._log_lock:
            self._log_lines.append(line)
            try:
                with self._log_file.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
            except OSError:
                pass
        self.on_log(str(text))

    def logs(self, limit=500):
        with self._log_lock:
            lines = list(self._log_lines)
        return lines[-max(1, min(limit, 500)):]

    def submit(self, links):
        with self.lock:
            if self.stopping.is_set():
                raise DownloadError("服务正在关闭")
            if sum(x["state"] in ("queued", "resolving") for x in self.items.values()) + len(links) > 30:
                raise DownloadError("队列最多容纳 30 个任务，请等待完成后再提交。")
            if len(self.items) + len(links) > 500:
                raise DownloadError("解析记录已达到 500 条；请重启远程版清理列表。手机内已下载的视频不受影响。")
            result = []
            for link in links:
                key = secrets.token_hex(12)
                job = {"id": key, "title": "等待解析", "link": link, "state": "queued", "message": "等待解析",
                       "created": time.time(), "cancel": threading.Event()}
                self.items[key] = job
                self.queue.put(key)
                result.append(key)
            self.emit(f"收到 {len(links)} 个解析任务")
            return result

    def update(self, key, **values):
        with self.lock:
            self.items[key].update(values)

    def snapshots(self):
        with self.lock:
            return [{k: v for k, v in job.items() if k not in ("cancel", "info")} for job in reversed(list(self.items.values()))]

    def cancel(self, key):
        with self.lock:
            job = self.items.get(key)
            if not job:
                return False
            job["cancel"].set()
            if job["state"] in ("queued", "ready"):
                job.update(state="cancelled", message="已取消")
            return True

    def video(self, key):
        with self.lock:
            job = self.items.get(key)
            if not job or job["state"] != "ready" or job["cancel"].is_set():
                return None
            if time.time() - job["resolved"] > 15 * 60:
                raise LinkExpired("解析链接已过期，请点击“重新解析”再下载。")
            return job["info"], job["cancel"]

    def run(self):
        while not self.stopping.is_set():
            try:
                key = self.queue.get(timeout=.3)
            except queue.Empty:
                continue
            job = self.items[key]
            cancel = job["cancel"]
            if cancel.is_set():
                continue
            self.active_cancel = cancel
            try:
                with self.browser_lock:
                    if cancel.is_set() or self.stopping.is_set():
                        raise Cancelled("已取消")
                    self.update(key, state="resolving", message="正在解析视频")
                    def log(message):
                        self.update(key, message=str(message))
                        self.emit(str(message))
                    info = self.resolver_factory(log, cancel).resolve(job["link"])
                    if cancel.is_set():
                        raise Cancelled("已取消")
                    self.update(key, title=info.title, state="ready", info=info, resolved=time.time(),
                                message="已解析，访客设备直接从视频源站下载")
                self.emit(f"已解析：{info.title}（只提供地址，不转发视频）")
            except Cancelled:
                self.update(key, state="cancelled", message="已取消")
            except Exception as exc:
                # Always leave the real failure reason in the server log;
                # the job message shown to visitors stays generic for
                # unexpected errors. Resolver stage logs pinpoint the stage.
                self.emit(f"解析失败：{type(exc).__name__}: {str(exc)[:200]}")
                self.update(key, state="failed", message=str(exc) if isinstance(exc, DownloadError) else "解析失败，请检查电脑网络后重试。")
            finally:
                self.active_cancel = None

    def stop(self):
        self.stopping.set()
        with self.lock:
            for job in self.items.values():
                job["cancel"].set()


def create_app(jobs, password, resources=None):
    resources = Path(resources or Path(__file__).parent / "web")
    app = Flask(__name__, template_folder=str(resources / "templates"), static_folder=str(resources / "static"))
    app.config.update(MAX_CONTENT_LENGTH=16 * 1024)
    password_hash = generate_password_hash(password)
    sessions = {}
    lock = threading.RLock()
    attempts = deque()
    cookie_name = "douyin_remote_session"

    def authorized():
        token = request.cookies.get(cookie_name, "")
        key = hashlib.sha256(token.encode()).hexdigest()
        with lock:
            session = sessions.get(key)
            if session and session["expires"] > time.time():
                return session
            sessions.pop(key, None)
        return None

    def protect(function):
        @wraps(function)
        def inner(*args, **kwargs):
            if not authorized():
                return jsonify(error="请先输入访问密码"), 401
            return function(*args, **kwargs)
        return inner

    @app.before_request
    def check_origin():
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            # JSON-only mutations prevent cross-site form submissions, including login CSRF.
            if not request.is_json:
                return jsonify(error="请求格式不正确"), 415
            origin = request.headers.get("Origin")
            if origin:
                from urllib.parse import urlsplit
                if urlsplit(origin).netloc != request.host:
                    return jsonify(error="请求来源不匹配"), 403
            if request.path != "/api/login":
                session = authorized()
                supplied = request.headers.get("X-CSRF-Token", "")
                if not session:
                    return jsonify(error="请先登录"), 401
                if not hmac.compare_digest(supplied, session["csrf"]):
                    return jsonify(error="页面已过期，请刷新后重试"), 403

    @app.after_request
    def secure_headers(response):
        # Windows registry sometimes maps .js to text/plain. Keep nosniff and fix the MIME type.
        if request.endpoint == "static":
            if request.path.endswith(".js"):
                response.headers["Content-Type"] = "text/javascript; charset=utf-8"
            elif request.path.endswith(".css"):
                response.headers["Content-Type"] = "text/css; charset=utf-8"
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' https: blob:; connect-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
        return response

    @app.errorhandler(413)
    def too_large(_):
        return jsonify(error="分享文案过长，请分批提交"), 413

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.post("/api/login")
    def login():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify(error="请求格式不正确"), 400
        supplied = body.get("password", "")
        if not isinstance(supplied, str) or len(supplied) > 128:
            return jsonify(error="密码格式不正确"), 400
        now = time.time()
        with lock:
            while attempts and attempts[0] < now - 60:
                attempts.popleft()
            if len(attempts) >= 8:
                return jsonify(error="尝试次数过多，请 1 分钟后重试"), 429
            attempts.append(now)
        if not check_password_hash(password_hash, supplied):
            return jsonify(error="密码不正确，请查看电脑上的远程版窗口"), 401
        token = secrets.token_urlsafe(32)
        session = {"csrf": secrets.token_urlsafe(24), "expires": now + 12 * 3600}
        with lock:
            for old in list(sessions):
                if sessions[old]["expires"] <= now:
                    sessions.pop(old)
            if len(sessions) >= 32:
                sessions.pop(next(iter(sessions)))
            sessions[hashlib.sha256(token.encode()).hexdigest()] = session
        response = jsonify(ok=True, csrf=session["csrf"])
        secure = request.is_secure or request.headers.get("X-Forwarded-Proto") == "https"
        response.set_cookie(cookie_name, token, max_age=12 * 3600, httponly=True, secure=secure, samesite="Strict", path="/")
        return response

    @app.get("/api/session")
    @protect
    def session_info():
        return jsonify(ok=True, csrf=authorized()["csrf"])

    @app.post("/api/logout")
    @protect
    def logout():
        token = request.cookies.get(cookie_name, "")
        with lock:
            sessions.pop(hashlib.sha256(token.encode()).hexdigest(), None)
        response = jsonify(ok=True)
        response.delete_cookie(cookie_name)
        return response

    @app.get("/api/jobs")
    @protect
    def list_jobs():
        return jsonify(jobs=jobs.snapshots())

    @app.get("/api/logs")
    @protect
    def list_logs():
        limit = request.args.get("limit", default=200, type=int) or 200
        return jsonify(logs=jobs.logs(limit))

    @app.post("/api/jobs")
    @protect
    def new_jobs():
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get("text"), str):
            return jsonify(error="请输入视频链接或分享文案"), 400
        try:
            links = extract_any_links(body["text"])
            if len(links) > 20:
                raise DownloadError("每次最多提交 20 个视频链接")
            return jsonify(ids=jobs.submit(links)), 202
        except DownloadError as exc:
            return jsonify(error=str(exc)), 400

    @app.post("/api/jobs/<key>/cancel")
    @protect
    def cancel_job(key):
        return (jsonify(ok=True), 200) if jobs.cancel(key) else (jsonify(error="任务不存在"), 404)

    def direct_info(key):
        try:
            video = jobs.video(key)
        except LinkExpired as exc:
            return None, (jsonify(error=str(exc)), 410)
        if not video:
            return None, (jsonify(error="链接尚未解析完成或任务不存在，请重新解析"), 404)
        info, _ = video
        urls = direct_links(info)
        if not urls:
            return None, (jsonify(error="源站没有返回可直接访问的 HTTPS 地址，请重新解析。"), 422)
        return {"urls": urls, "filename": f"{safe_name(info.title)}_{info.id}.mp4", "delivery": "direct-origin"}, None

    @app.get("/api/jobs/<key>/direct")
    @protect
    def direct_metadata(key):
        data, error = direct_info(key)
        return error if error else jsonify(data)

    def relay_headers(info):
        # Only User-Agent and Referer are taken from the parse-time headers,
        # plus cookies stored separately on the job. Anything else in
        # info.headers (including a Cookie entry) is never forwarded.
        headers = {}
        source = info.headers or {}
        if source.get("User-Agent"):
            headers["User-Agent"] = source["User-Agent"]
        if source.get("Referer"):
            headers["Referer"] = source["Referer"]
        cookies = []
        for cookie in info.cookies or []:
            try:
                cookies.append(f"{cookie.name}={cookie.value}")
            except Exception:
                continue
        if cookies:
            headers["Cookie"] = "; ".join(cookies)
        return headers

    @app.get("/files/<key>/relay")
    @protect
    def video_relay(key):
        # Streaming relay (authorized 2026-10-26, replacing the no-relay rule
        # for downloads): fetch from a resolved Douyin origin and forward
        # bytes as they arrive. Nothing is written to disk, and no URL other
        # than this job's resolved HTTPS addresses is ever fetched.
        try:
            video = jobs.video(key)
        except LinkExpired as exc:
            return jsonify(error=str(exc)), 410
        if not video:
            return jsonify(error="链接尚未解析完成或任务不存在，请重新解析"), 404
        info, _ = video
        urls = direct_links(info)
        if not urls:
            return jsonify(error="源站没有返回可用的 HTTPS 地址，请重新解析"), 422
        headers = relay_headers(info)
        filename = f"{safe_name(info.title)}_{info.id}.mp4"
        for url in urls:
            upstream = None
            try:
                upstream = urllib.request.urlopen(
                    urllib.request.Request(url, headers=headers), timeout=30)
                content_type = (upstream.headers.get("Content-Type") or "").lower()
                if upstream.status != 200 or ("video/" not in content_type
                                             and "octet-stream" not in content_type):
                    upstream.close()
                    continue
            except Exception:
                if upstream is not None:
                    try:
                        upstream.close()
                    except Exception:
                        pass
                continue
            length = upstream.headers.get("Content-Length")

            def generate(upstream=upstream):
                try:
                    while True:
                        chunk = upstream.read(256 * 1024)
                        if not chunk:
                            break
                        yield chunk
                finally:
                    upstream.close()

            response = Response(stream_with_context(generate()), mimetype="video/mp4")
            response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
            if length:
                response.headers["Content-Length"] = length
            return response
        return jsonify(error="源站拒绝中转或地址已过期，请重新解析"), 502

    @app.get("/files/<key>")
    @protect
    def video_file(key):
        # Only a redirect. The PC never opens, HEADs, buffers or relays the video URL.
        data, error = direct_info(key)
        if error:
            return error
        index = request.args.get("source", default=0, type=int)
        if index is None or not 0 <= index < len(data["urls"]):
            return jsonify(error="视频地址编号不正确"), 400
        response = redirect(data["urls"][index], code=302)
        response.headers["X-Video-Delivery"] = "direct-origin"
        return response

    return app
