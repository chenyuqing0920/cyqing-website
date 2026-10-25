import importlib.util
from pathlib import Path
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("portal_proxy", ROOT / "backend/stack/proxy.py")
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)

class PortalProxyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = proxy.ThreadingHTTPServer(("127.0.0.1", 0), proxy.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:" + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(2)

    def test_canonical_portal_and_asset_types(self):
        with urlopen(self.url) as response:
            html = response.read().decode()
            self.assertIn('id="video-frame"', html)
            self.assertIn('id="files-frame"', html)
        for asset, mime in proxy.PORTAL_ASSETS.items():
            with urlopen(self.url + "/portal-assets/" + asset + "?v=check") as response:
                self.assertTrue(response.headers["Content-Type"].startswith(mime))
                self.assertGreater(len(response.read()), 100)
            with urlopen(Request(self.url + "/portal-assets/" + asset, method="HEAD")) as response:
                self.assertEqual(response.read(), b"")

    def test_assets_allowlist_blocks_unknown_and_traversal(self):
        for path in ["/portal-assets/unknown.js", "/portal-assets/../README.md", "/portal-assets/%2e%2e/app.py"]:
            with self.assertRaises(HTTPError) as error:
                urlopen(self.url + path)
            self.assertEqual(error.exception.code, 404)

if __name__ == "__main__":
    unittest.main()
