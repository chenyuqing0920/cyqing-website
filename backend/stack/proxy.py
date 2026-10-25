#!/usr/bin/env python3
"""前置分流代理（标准库实现）：同一公网域名下的工具门户分流。
  /                   -> 门户主页 portal.html（代理直出）
  /files 或 /files/*  -> 文件小站 127.0.0.1:7864
  /douyin 或 /douyin/*-> 随手存 127.0.0.1:7863（转发时剥掉 /douyin 前缀）
  其余（/api、/static 等随手存原生路径）-> 随手存 127.0.0.1:7863
隧道仍指向本代理端口 7860。请求体与响应体均为流式转发，不整文件载入内存。"""
import http.client
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

# Read the canonical source on every request. This also supports Windows
# checkouts where Git stores a symlink as its target text.
PORTAL_FILE = Path(__file__).resolve().parents[2] / "portal" / "portal.html"
PORTAL_ASSETS = {"style.css": "text/css; charset=utf-8",
                 "app.js": "text/javascript; charset=utf-8",
                 "content.js": "text/javascript; charset=utf-8"}

FILES_PORT = int(os.environ.get("PROXY_FILES_PORT", "7864"))
DOUYIN_PORT = int(os.environ.get("PROXY_DOUYIN_PORT", "7863"))
LISTEN_PORT = int(os.environ.get("PROXY_PORT", "7860"))

HOP = {"connection", "keep-alive", "proxy-connection", "te", "trailer",
       "transfer-encoding", "upgrade"}


def body_chunks(handler, length):
    remaining = length
    while remaining > 0:
        chunk = handler.rfile.read(min(131072, remaining))
        if not chunk:
            break
        remaining -= len(chunk)
        yield chunk


def chunked_chunks(handler):
    while True:
        size_line = handler.rfile.readline(65536).strip()
        try:
            size = int(size_line.split(b";")[0], 16)
        except ValueError:
            return
        if size == 0:
            while True:
                line = handler.rfile.readline(65536)
                if line in (b"\r\n", b"\n", b""):
                    break
            return
        remaining = size
        while remaining > 0:
            chunk = handler.rfile.read(min(131072, remaining))
            if not chunk:
                return
            remaining -= len(chunk)
            yield chunk
        handler.rfile.readline(65536)  # trailing CRLF


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _serve_portal(self):
        try:
            data = PORTAL_FILE.read_bytes()
        except OSError:
            data = b"portal missing"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _forward(self):
        parts = urlsplit(self.path)
        p = parts.path
        if self.command in ("GET", "HEAD") and p.startswith("/portal-assets/"):
            name = p[len("/portal-assets/"):]
            if name not in PORTAL_ASSETS:
                self.send_error(404)
                return
            try:
                data = (PORTAL_FILE.parent / name).read_bytes()
            except OSError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", PORTAL_ASSETS[name])
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
            return
        if self.command in ("GET", "HEAD") and p == "/":
            self._serve_portal()
            return
        query = ("?" + parts.query) if parts.query else ""
        if p == "/files" or p.startswith("/files/"):
            port = FILES_PORT
            out_path = p + query
        elif p == "/douyin" or p.startswith("/douyin/"):
            port = DOUYIN_PORT
            out_path = (p[len("/douyin"):] or "/") + query
        else:
            port = DOUYIN_PORT
            out_path = p + query
        headers = {}
        for k, v in self.headers.items():
            if k.lower() not in HOP and k.lower() != "host":
                headers[k] = v
        # 透传原始 Host：随后端有 Origin 与 Host 一致性校验（防 CSRF），
        # 改写成 127.0.0.1 会让浏览器发来的 POST 全部 403（请求来源不匹配）。
        original_host = self.headers.get("Host")
        headers["Host"] = original_host if original_host else f"127.0.0.1:{port}"
        headers["X-Forwarded-For"] = self.client_address[0]
        # 不传 X-Forwarded-Proto：后端按 http 处理与现网直连时一致，
        # 避免会话 Cookie 被标记 Secure 而在内部 http 跳上丢失。

        te = (self.headers.get("Transfer-Encoding") or "").lower()
        cl = self.headers.get("Content-Length")
        body = None
        if te == "chunked":
            body = chunked_chunks(self)
        elif cl is not None:
            try:
                body = body_chunks(self, int(cl))
            except ValueError:
                body = None

        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=600)
        try:
            conn.request(self.command, out_path, body=body,
                         headers=headers, encode_chunked=body is not None)
            resp = conn.getresponse()
        except Exception:
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", "12")
            self.end_headers()
            try:
                self.wfile.write(b"bad gateway\n")
            except Exception:
                pass
            conn.close()
            return

        self.send_response(resp.status, resp.reason)
        has_length = False
        for k, v in resp.getheaders():
            lk = k.lower()
            if lk in HOP:
                continue
            if lk == "content-length":
                has_length = True
            self.send_header(k, v)
        if not has_length:
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        try:
            while True:
                chunk = resp.read(131072)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except Exception:
            pass
        conn.close()

    do_GET = _forward
    do_POST = _forward
    do_PUT = _forward
    do_DELETE = _forward
    do_PATCH = _forward
    do_HEAD = _forward
    do_OPTIONS = _forward


if __name__ == "__main__":
    print(f"proxy on 127.0.0.1:{LISTEN_PORT} files->{FILES_PORT} douyin->{DOUYIN_PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", LISTEN_PORT), Handler).serve_forever()
