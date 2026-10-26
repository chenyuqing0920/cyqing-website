import io
import os
import tempfile
import threading
import time
import unittest
from functools import partial
from unittest.mock import patch
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from pathlib import Path

from downloader import Video
from web_server import Jobs, create_app


class FakeResolver:
    url = "https://cdn.example.test/video.mp4?temporary=123"
    def __init__(self, log, cancel):
        self.cancel = cancel

    def resolve(self, url):
        return Video("123", "手机测试", [self.url], {"Cookie": "server-secret"})


class _PipeReader:
    """stderr stand-in for CurlRelay: a real pipe fd for select/os.read."""

    def __init__(self, fd):
        self._fd = fd

    def fileno(self):
        return self._fd

    def close(self):
        try:
            os.close(self._fd)
        except OSError:
            pass


class WebTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.jobs = Jobs(FakeResolver)
        self.app = create_app(self.jobs, "testing-password-42")
        self.client = self.app.test_client()

    def tearDown(self):
        self.jobs.stop()
        self.jobs.worker.join(2)
        self.temp.cleanup()

    def login(self):
        response = self.client.post("/api/login", json={"password": "testing-password-42"})
        self.assertEqual(response.status_code, 200)
        return {"X-CSRF-Token": response.json["csrf"]}

    def test_auth_cookies_and_logout(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
        policy = response.headers["Content-Security-Policy"]
        self.assertIn("frame-ancestors 'self'", policy)
        self.assertIn("script-src 'self'", policy)
        self.assertIn("style-src 'self'", policy)
        self.assertIn("form-action 'self'", policy)
        self.assertNotIn("'unsafe-inline'", policy)
        with self.client.get("/static/app.js") as response:
            self.assertTrue(response.content_type.startswith("text/javascript"))
        self.assertEqual(self.client.get("/api/jobs").status_code, 401)
        self.assertEqual(self.client.get("/files/anything").status_code, 401)
        self.assertEqual(self.client.post("/api/login", json={"password": "wrong"}).status_code, 401)
        headers = self.login()
        self.assertEqual(self.client.get("/api/session").status_code, 200)
        self.assertEqual(self.client.post("/api/logout", json={}, headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/api/jobs").status_code, 401)

    def test_csrf_origin_and_input_limits(self):
        headers = self.login()
        self.assertEqual(self.client.post("/api/jobs", json={"text": "x"}).status_code, 403)
        self.assertEqual(self.client.post("/api/jobs", json={"text": "x"}, headers={**headers, "Origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(self.client.post("/api/jobs", json={"text": "file:///C:/Users"}, headers=headers).status_code, 400)
        self.assertEqual(self.client.post("/api/jobs", json=["bad"], headers=headers).status_code, 400)
        self.assertEqual(self.client.post("/api/jobs", json={"text": "x" * 20000}, headers=headers).status_code, 413)
        self.assertEqual(self.client.get("/files/../../remote-access.json").status_code, 404)

    def test_direct_metadata_and_redirect_without_video_connection(self):
        headers = self.login()
        response = self.client.post("/api/jobs", json={"text": "https://www.douyin.com/video/123"}, headers=headers)
        self.assertEqual(response.status_code, 202)
        key = response.json["ids"][0]
        for _ in range(60):
            jobs = self.client.get("/api/jobs").json["jobs"]
            if jobs[0]["state"] == "ready":
                break
            time.sleep(.02)
        self.assertEqual(jobs[0]["state"], "ready")
        self.assertNotIn("path", jobs[0])
        self.assertNotIn("cancel", jobs[0])
        self.assertNotIn("info", jobs[0])
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])
        with patch("socket.create_connection", side_effect=AssertionError("Server must not connect to video origin")):
            response = self.client.get(f"/api/jobs/{key}/direct")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json["delivery"], "direct-origin")
            self.assertEqual(response.json["urls"], [FakeResolver.url])
            self.assertNotIn("server-secret", response.get_data(as_text=True))
            response = self.client.get(f"/files/{key}?download=1", headers={"Range": "bytes=0-15"})
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.headers["Location"], FakeResolver.url)
            self.assertEqual(response.headers["X-Video-Delivery"], "direct-origin")
            self.assertLess(len(response.data), 1000)
            response = self.client.head(f"/files/{key}")
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.data, b"")
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])
        self.jobs.update(key, resolved=time.time() - 1000)
        self.assertEqual(self.client.get(f"/files/{key}").status_code, 410)

    def test_relay_streams_resolved_url_only(self):
        headers = self.login()
        response = self.client.post("/api/jobs", json={"text": "https://www.douyin.com/video/123"}, headers=headers)
        self.assertEqual(response.status_code, 202)
        key = response.json["ids"][0]
        for _ in range(60):
            if self.jobs.video(key):
                break
            time.sleep(.02)
        self.assertTrue(self.jobs.video(key))
        body = b"0123456789" * 100

        captured = {}

        class FakeCurlProc:
            def __init__(self, cmd, stdout, stderr):
                captured["argv"] = cmd
                self.stdout = io.BytesIO(body)
                r, w = os.pipe()
                os.write(w, b"HTTP/1.1 200 Connection Established\r\n\r\n"
                            b"HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\n"
                            b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n")
                os.close(w)
                self.stderr = _PipeReader(r)

            def poll(self):
                return 0

            def kill(self):
                pass

            def wait(self, timeout=None):
                return 0

        with patch("web_server.subprocess.Popen", FakeCurlProc), patch("web_server.select.select", lambda r, w, e, t: (r, [], [])):
            with self.client.get(f"/files/{key}/relay") as response:
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content_type, "video/mp4")
                self.assertIn("attachment;", response.headers["Content-Disposition"])
                self.assertIn("123.mp4", response.headers["Content-Disposition"])
                self.assertEqual(response.data, body)
        with patch("web_server.subprocess.Popen", FakeCurlProc), patch("web_server.select.select", lambda r, w, e, t: (r, [], [])):
            with self.client.get(f"/files/{key}/relay?inline=1") as preview:
                self.assertEqual(preview.status_code, 200)
                self.assertTrue(preview.headers["Content-Disposition"].startswith("inline;"))
                self.assertIn("filename*=UTF-8", preview.headers["Content-Disposition"])
                self.assertEqual(preview.data, body)
        self.assertEqual(captured["argv"][-1], FakeResolver.url)
        self.assertNotIn("Cookie", str(captured["argv"]))
        self.assertNotIn("server-secret", str(captured["argv"]))

        class RefusedCurlProc(FakeCurlProc):
            def __init__(self, cmd, stdout, stderr):
                captured["argv"] = cmd
                self.stdout = io.BytesIO(b"")
                r, w = os.pipe()
                os.write(w, b"HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\n\r\n")
                os.close(w)
                self.stderr = _PipeReader(r)

        with patch("web_server.subprocess.Popen", RefusedCurlProc), patch("web_server.select.select", lambda r, w, e, t: (r, [], [])):
            response = self.client.get(f"/files/{key}/relay")
            self.assertEqual(response.status_code, 502)

    def test_relay_forwards_range_for_resume(self):
        headers = self.login()
        response = self.client.post("/api/jobs", json={"text": "https://www.douyin.com/video/123"}, headers=headers)
        key = response.json["ids"][0]
        for _ in range(60):
            if self.jobs.video(key):
                break
            time.sleep(.02)
        body = b"0123456789" * 100

        captured = {}

        class RangeCurlProc:
            def __init__(self, cmd, stdout, stderr):
                captured["argv"] = cmd
                self.stdout = io.BytesIO(body[100:500])
                r, w = os.pipe()
                os.write(w, b"HTTP/1.1 200 Connection Established\r\n\r\n"
                            b"HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\n"
                            b"Content-Length: 400\r\n"
                            b"Content-Range: bytes 100-499/1000\r\n\r\n")
                os.close(w)
                self.stderr = _PipeReader(r)

            def poll(self):
                return 0

            def kill(self):
                pass

            def wait(self, timeout=None):
                return 0

        with patch("web_server.subprocess.Popen", RangeCurlProc), patch("web_server.select.select", lambda r, w, e, t: (r, [], [])):
            with self.client.get(f"/files/{key}/relay?inline=1", headers={"Range": "bytes=100-499"}) as response:
                self.assertEqual(response.status_code, 206)
                self.assertEqual(response.headers["Content-Range"], "bytes 100-499/1000")
                self.assertEqual(response.headers["Accept-Ranges"], "bytes")
                self.assertEqual(len(response.data), 400)
        self.assertIn("Range: bytes=100-499", captured["argv"])

    def test_rate_limit_and_secure_cookie(self):
        for _ in range(8):
            self.client.post("/api/login", json={"password": "wrong"})
        self.assertEqual(self.client.post("/api/login", json={"password": "wrong"}).status_code, 429)
        second_app = create_app(self.jobs, "pass")
        with second_app.test_client() as client:
            response = client.post("/api/login", json={"password": "pass"}, headers={"X-Forwarded-Proto": "https"})
            cookie = response.headers["Set-Cookie"]
            self.assertIn("Secure;", cookie)
            self.assertIn("HttpOnly;", cookie)
            self.assertIn("SameSite=Strict", cookie)

    def test_http_service_only_returns_redirect(self):
        from waitress import create_server
        self.login()
        key = self.jobs.submit(["https://www.douyin.com/video/123"])[0]
        for _ in range(50):
            if self.jobs.video(key): break
            time.sleep(.02)
        server = create_server(self.app, map={}, host="127.0.0.1", port=0, threads=2,
                               outbuf_high_watermark=128 * 1024, outbuf_overflow=1024 * 1024)
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        try:
            cookie = self.client.get_cookie("douyin_remote_session").value
            request = Request(f"http://127.0.0.1:{server.effective_port}/files/{key}?download=1", headers={"Cookie": "douyin_remote_session=" + cookie})
            class NoRedirect(HTTPRedirectHandler):
                def redirect_request(self, *args): return None
            with patch("waitress.buffers.TempfileBasedBuffer", side_effect=AssertionError("No video caching")) as disk_buffer:
                with self.assertRaises(HTTPError) as result:
                    build_opener(NoRedirect()).open(request, timeout=10)
                response = result.exception
                self.assertEqual(response.code, 302)
                self.assertEqual(response.headers["Location"], FakeResolver.url)
                self.assertLess(len(response.read()), 1000)
                response.close()
                disk_buffer.assert_not_called()
        finally:
            server.close()
            server.task_dispatcher.shutdown()
            thread.join(2)


if __name__ == "__main__":
    unittest.main()
