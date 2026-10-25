"""Loopback-only UI test fixture; all runtime data is temporary.

The video resolver is deterministic and does not contact a real social site.
The file service performs real uploads/downloads in an isolated temp folder.
"""
import importlib.util
import os
from pathlib import Path
import signal
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
runtime = tempfile.TemporaryDirectory(prefix="cyqing-ui-")
os.environ["DOUYIN_DATA_DIR"] = str(Path(runtime.name) / "video")
os.environ["FILE_DROP_DATA_DIR"] = str(Path(runtime.name) / "file-drop")
os.environ["PROXY_PORT"] = "18760"
os.environ["PROXY_FILES_PORT"] = "18764"
os.environ["PROXY_DOUYIN_PORT"] = "18763"

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result

sys.path.insert(0, str(ROOT / "douyin"))
from downloader import Video
from web_server import Jobs, create_app
from waitress import create_server

class FixtureResolver:
    def __init__(self, log, cancel):
        self.cancel = cancel

    def resolve(self, url):
        return Video("fixture", "界面测试视频（模拟解析）", ["https://cdn.example.test/video.mp4"], {})

files = module("ui_file_drop", ROOT / "backend/file-drop/app.py")
files.PASSWORD = "ui-fixture-only"
jobs = Jobs(FixtureResolver)
video = create_app(jobs, "ui-fixture-only")
proxy = module("ui_proxy", ROOT / "backend/stack/proxy.py")
servers = [
    create_server(video, host="127.0.0.1", port=18763, threads=4),
    create_server(files.app, host="127.0.0.1", port=18764, threads=4),
    proxy.ThreadingHTTPServer(("127.0.0.1", 18760), proxy.Handler),
]
for server in servers:
    target = server.serve_forever if hasattr(server, "serve_forever") else server.run
    threading.Thread(target=target, daemon=True).start()
print("UI fixture at http://127.0.0.1:18760 (temporary data, simulated video resolver)", flush=True)
stopped = threading.Event()
def stop(*_):
    stopped.set()
signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
try:
    while not stopped.wait(1):
        pass
finally:
    jobs.stop()
    servers[-1].shutdown()
    servers[-1].server_close()
    for server in servers[:-1]:
        server.close()
    runtime.cleanup()
