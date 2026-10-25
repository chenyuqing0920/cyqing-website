"""Exercise real file flows against disposable storage, without production credentials."""
import importlib.util
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path


class FileDropTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="cyqing-filedrop-test-")
        old = os.environ.get("FILE_DROP_DATA_DIR")
        os.environ["FILE_DROP_DATA_DIR"] = cls.temp.name
        try:
            path = Path(__file__).resolve().parents[1] / "app.py"
            spec = importlib.util.spec_from_file_location("file_drop_test_app", path)
            cls.module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = cls.module
            spec.loader.exec_module(cls.module)
        finally:
            if old is None:
                os.environ.pop("FILE_DROP_DATA_DIR", None)
            else:
                os.environ["FILE_DROP_DATA_DIR"] = old
        cls.module.app.config.update(TESTING=True)

    @classmethod
    def tearDownClass(cls):
        sys.modules.pop("file_drop_test_app", None)
        cls.temp.cleanup()

    def setUp(self):
        self.client = self.module.app.test_client()
        self.module.attempts.clear()
        for path in self.module.FILES_DIR.iterdir():
            path.unlink()

    def login(self):
        return self.client.post("/files/login", data={"password": self.module.PASSWORD})

    def test_runtime_isolation_and_unauthorized_requests(self):
        self.assertEqual(self.module.FILES_DIR.parent, Path(self.temp.name).resolve())
        self.assertEqual(Path(self.module.app.template_folder), self.module.BASE / "templates")
        self.assertTrue(self.module.PW_FILE.is_file())
        page = self.client.get("/files/")
        self.assertEqual(page.status_code, 200)
        self.assertIn('autocomplete="current-password"', page.get_data(as_text=True))
        for method, route in (("post", "/files/upload"), ("get", "/files/download/a.txt"),
                              ("post", "/files/delete/a.txt")):
            response = getattr(self.client, method)(route)
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.location, "/files/")
        self.assertFalse(list(self.module.FILES_DIR.iterdir()))

    def test_authentication_session_logout_and_rate_limit(self):
        wrong = self.client.post("/files/login", data={"password": "wrong-test-password"})
        self.assertEqual(wrong.status_code, 401)
        self.assertIn('role="alert"', wrong.get_data(as_text=True))
        response = self.login()
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.headers["Set-Cookie"].startswith("session="))
        self.assertIn('<form id="upload-form"', self.client.get("/files/").get_data(as_text=True))
        self.client.post("/files/logout")
        self.assertNotIn('<form id="upload-form"', self.client.get("/files/").get_data(as_text=True))
        self.module.attempts.clear()
        for _ in range(8):
            self.assertEqual(self.client.post("/files/login", data={"password": "wrong"}).status_code, 401)
        self.assertEqual(self.login().status_code, 429)

    def test_multiple_upload_duplicate_name_download_delete(self):
        self.login()
        response = self.client.post("/files/upload", data={"files": [
            (io.BytesIO(b"first-content"), "demo.txt"),
            (io.BytesIO(b"second-content"), "demo.txt"),
        ]}, content_type="multipart/form-data", follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual((self.module.FILES_DIR / "demo.txt").read_bytes(), b"first-content")
        self.assertEqual((self.module.FILES_DIR / "demo (1).txt").read_bytes(), b"second-content")
        download = self.client.get("/files/download/demo.txt")
        self.assertEqual(download.data, b"first-content")
        self.assertIn("attachment", download.headers["Content-Disposition"])
        download.close()
        self.assertEqual(self.client.post("/files/delete/demo.txt").status_code, 302)
        self.assertEqual(self.client.get("/files/download/demo.txt").status_code, 404)

    def test_filename_rendering_is_not_javascript(self):
        self.login()
        filename = "note');alert(1);'.txt"
        self.client.post("/files/upload", data={"files": (io.BytesIO(b"safe"), filename)},
                         content_type="multipart/form-data")
        html = self.client.get("/files/").get_data(as_text=True)
        self.assertIn("data-name=", html)
        self.assertIn("&#39;", html)
        self.assertNotIn("onsubmit=", html)
        self.assertIn("form.dataset.name", html)
        self.assertIn("document.documentElement.classList.toggle('embedded',self!==top)", html)
        self.assertEqual(self.client.get("/files/download/../data/password.txt").status_code, 404)


if __name__ == "__main__":
    unittest.main()
