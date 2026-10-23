"""Local Douyin resolver and atomic MP4 downloader. No hosted parsing service."""
from __future__ import annotations

import base64
import html
import http.cookiejar
import json
import os
import re
import socket
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"


def _clean(text, limit=160):
    """One-line, log-safe text: URLs lose their query string (queries can
    carry signatures), whitespace collapses. Never pass cookies or full
    signed URLs here."""
    text = re.sub(r"(https?://[^\s?]+)\?[^\s]*", r"\1?…", str(text))
    return " ".join(text.split())[:limit]


def _host(url):
    try:
        return urlparse(url).hostname or "?"
    except ValueError:
        return "?"


def _default_data_dir():
    override = os.environ.get("DOUYIN_DATA_DIR")
    if override:
        return Path(override).expanduser()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home())))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:  # Linux and other POSIX systems follow the XDG base directory spec.
        base = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share")))
    return base / "DouyinLocalDownloader"


DATA = _default_data_dir()


class DownloadError(Exception):
    pass


class Cancelled(DownloadError):
    pass


def check_cancel(cancel):
    if cancel.is_set():
        raise Cancelled("已取消")


def is_douyin(url):
    p = urlparse(url)
    return p.scheme in ("http", "https") and (p.hostname or "").lower() in {
        "douyin.com", "www.douyin.com", "v.douyin.com", "iesdouyin.com", "www.iesdouyin.com",
    } and not p.username and not p.password and p.port in (None, 80, 443)


def extract_links(text):
    links = []
    for value in re.findall(r"https?://[^\s<>\"\u3000]+", text):
        value = value.rstrip(".,;!?，。；！？、）)]}〉》'”")
        try:
            valid = is_douyin(value)
        except ValueError:
            valid = False
        if valid and value not in links:
            links.append(value)
    if not links:
        raise DownloadError("没有找到抖音链接。请粘贴抖音的“复制链接”分享文案或视频网址。")
    return links


def _is_public_url(value):
    try:
        p = urlparse(value)
    except ValueError:
        return False
    return p.scheme in ("http", "https") and bool(p.hostname) \
        and not p.username and not p.password and p.port in (None, 80, 443)


def extract_any_links(text):
    """Douyin links win when present; otherwise accept any public video URL
    and let the yt-dlp resolver figure out the platform."""
    try:
        return extract_links(text)
    except DownloadError:
        pass
    links = []
    for value in re.findall(r"https?://[^\s<>\"\u3000]+", text):
        value = value.rstrip(".,;!?，。；！？、）)]}〉》'”")
        if _is_public_url(value) and value not in links:
            links.append(value)
    if not links:
        raise DownloadError("没有找到视频链接。请粘贴视频网址或 App 的“复制链接”分享文案。")
    return links


class _YtdlpQuiet:
    def debug(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): pass


class _YtdlpLog:
    """Like _YtdlpQuiet but remembers the last error line so a failed stage
    can be diagnosed from the server log instead of failing silently."""
    def __init__(self):
        self.last_error = ""
    def debug(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg):
        self.last_error = str(msg)


def _ytdlp_cookiefile():
    """Optional cookies for platforms that gate parsing behind a login
    (YouTube bot check, Bilibili risk control, Douyin fresh cookies)."""
    env = os.environ.get("YDLP_COOKIEFILE")
    if env and Path(env).expanduser().is_file():
        return str(Path(env).expanduser())
    candidate = DATA / "cookies.txt"
    if candidate.is_file():
        return str(candidate)
    return None


def _muxed_urls(data, mp4_only=False):
    """Formats that carry audio+video in one file, best first. The web flow
    hands a single direct URL to the visitor's device, so split audio/video
    (DASH) formats cannot be used here."""
    formats = [f for f in data.get("formats", [])
               if f.get("url") and f.get("vcodec") not in (None, "none")
               and f.get("acodec") not in (None, "none")
               and (not mp4_only or f.get("ext") == "mp4")]
    formats.sort(key=lambda f: (f.get("height") or 0, f.get("tbr") or 0), reverse=True)
    return formats


def video_id(url):
    match = re.search(r"/(?:share/)?(?:video|note)/(\d+)", urlparse(url).path)
    if match:
        return match[1]
    q = parse_qs(urlparse(url).query)
    for key in ("modal_id", "aweme_id", "vid"):
        value = q.get(key, [""])[0]
        if value.isdigit():
            return value
    return None


def safe_name(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")[:70].rstrip(" .")
    if not value:
        return "抖音视频"
    if value.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}:
        value = "_" + value
    return value


@dataclass
class Video:
    id: str
    title: str
    urls: list[str]
    headers: dict = field(default_factory=dict)
    cookies: list = field(default_factory=list)


def walk_details(data, wanted):
    """Only accept the requested post; recommendation responses are ignored."""
    if isinstance(data, dict):
        if str(data.get("aweme_id", "")) == wanted and isinstance(data.get("video"), dict):
            return data
        for child in data.values():
            found = walk_details(child, wanted)
            if found:
                return found
    elif isinstance(data, list):
        for child in data:
            found = walk_details(child, wanted)
            if found:
                return found
    return None


def from_detail(detail):
    v = detail["video"]
    addresses = []
    # Prefer the ordinary H.264 playback stream when the site supplies one.
    addresses.append(v.get("play_addr_h264", {}))
    for rate in sorted(v.get("bit_rate") or [], key=lambda x: x.get("bit_rate", 0), reverse=True):
        if not rate.get("is_bytevc1") and not rate.get("is_h265"):
            addresses.append(rate.get("play_addr", {}))
    addresses.extend([v.get("play_addr", {}), v.get("download_addr", {})])
    urls = []
    for addr in addresses:
        for url in addr.get("url_list", []):
            if isinstance(url, str) and url.startswith(("https://", "http://")) and url not in urls:
                urls.append(url)
    if not urls:
        raise DownloadError("该作品没有可下载的视频，可能是图文作品或作品已不可访问。")
    return Video(str(detail["aweme_id"]), detail.get("desc") or "抖音视频", urls)


def detail_from_html(page, wanted):
    # Published mobile pages use _ROUTER_DATA; older pages use RENDER_DATA.
    for match in re.finditer(r"(?:window\.)?_ROUTER_DATA\s*=\s*", page):
        try:
            data, _ = json.JSONDecoder().raw_decode(page[match.end():].lstrip())
            found = walk_details(data, wanted)
            if found:
                return from_detail(found)
        except (ValueError, TypeError):
            pass
    for content in re.findall(r'<script\b[^>]*>(.*?)</script>', page, re.S | re.I):
        for raw in (content.strip(), unquote(html.unescape(content.strip()))):
            try:
                found = walk_details(json.loads(raw), wanted)
                if found:
                    return from_detail(found)
            except (ValueError, TypeError):
                pass
    return None


class Resolver:
    def __init__(self, log, cancel, browser_timeout=100):
        self.log, self.cancel, self.browser_timeout = log, cancel, browser_timeout
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.jar))

    def resolve(self, url):
        check_cancel(self.cancel)
        if not is_douyin(url):
            return self.ytdlp_resolve(url)
        wanted = video_id(url)
        if not wanted:
            self.log("正在展开分享短链接…")
            try:
                with self.opener.open(Request(url, headers={"User-Agent": MOBILE_UA}), timeout=20) as response:
                    target = response.url
                    if not is_douyin(target):
                        raise DownloadError("分享链接跳转到了非抖音页面")
                    wanted = video_id(target)
            except DownloadError:
                raise
            except Exception as exc:
                self.log(f"短链接展开失败：{type(exc).__name__}: {_clean(exc, 120)}")
                raise DownloadError("短链接无法打开，请检查网络或使用完整视频网址。") from exc
        if not wanted:
            raise DownloadError("链接中没有找到视频编号；请使用单个视频的分享链接。")
        self.log(f"正在解析视频 {wanted}…")
        mobile = f"https://www.iesdouyin.com/share/video/{wanted}/"
        try:
            with self.opener.open(Request(mobile, headers={"User-Agent": MOBILE_UA}), timeout=15) as response:
                status = response.status
                info = detail_from_html(response.read(8 * 1024 * 1024).decode("utf-8", "replace"), wanted)
            if info:
                info.headers = {"User-Agent": MOBILE_UA, "Referer": "https://www.douyin.com/"}
                info.cookies = list(self.jar)
                return info
            self.log(f"阶段1 分享页：HTTP {status}，页面未包含该作品数据，转下一级")
        except DownloadError:
            raise
        except Exception as exc:
            self.log(f"阶段1 分享页失败：{type(exc).__name__}: {_clean(exc, 120)}")
        check_cancel(self.cancel)
        # yt-dlp remains replaceable through requirements.txt / the update script.
        self.log("分享页未返回视频，尝试开源解析引擎…")
        ytdlp_log = _YtdlpLog()
        try:
            import yt_dlp
            opts = {"quiet": True, "no_warnings": True, "logger": ytdlp_log, "socket_timeout": 12,
                    "retries": 0, "extractor_retries": 0, "noplaylist": True}
            cookiefile = _ytdlp_cookiefile()
            if cookiefile:
                opts["cookiefile"] = cookiefile
            with yt_dlp.YoutubeDL(opts) as ydl:
                data = ydl.extract_info(f"https://www.douyin.com/video/{wanted}", download=False)
            formats = _muxed_urls(data, mp4_only=True)
            if formats:
                return Video(wanted, data.get("title") or "抖音视频", [f["url"] for f in formats],
                             {**data.get("http_headers", {}), **formats[0].get("http_headers", {})}, list(ydl.cookiejar))
            self.log("阶段2 yt-dlp：未返回可用的合并 MP4 流，转浏览器级")
        except Exception as exc:
            detail = ytdlp_log.last_error or str(exc)
            self.log(f"阶段2 yt-dlp 失败：{type(exc).__name__}: {_clean(detail, 140)}")
        check_cancel(self.cancel)
        return self.browser_resolve(wanted)

    def ytdlp_resolve(self, url):
        """Generic path for every non-Douyin platform via yt-dlp."""
        check_cancel(self.cancel)
        if not _is_public_url(url):
            raise DownloadError("链接格式不正确")
        self.log("正在用开源解析引擎解析该平台链接…")
        import yt_dlp
        opts = {"quiet": True, "no_warnings": True, "logger": _YtdlpQuiet(), "socket_timeout": 30,
                "retries": 1, "extractor_retries": 1, "noplaylist": True}
        cookiefile = _ytdlp_cookiefile()
        if cookiefile:
            opts["cookiefile"] = cookiefile
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                data = ydl.extract_info(url, download=False)
                cookies = list(ydl.cookiejar)
        except Exception as exc:
            message = str(exc)
            if "Unsupported URL" in message:
                raise DownloadError("暂不支持这个平台的链接（yt-dlp 没有对应的解析器）。")
            if "cookie" in message.lower():
                raise DownloadError("该平台要求登录状态才能解析。请把该站的 cookies.txt 放到数据目录后重试。")
            raise DownloadError("解析失败：" + message.replace("\n", " ")[:160])
        if data.get("entries"):
            data = next((e for e in data["entries"] if e), data)
        formats = _muxed_urls(data)
        if formats:
            headers = {**data.get("http_headers", {}), **formats[0].get("http_headers", {})}
            return Video(str(data.get("id") or "video"), data.get("title") or "视频",
                         [f["url"] for f in formats], headers, cookies)
        if data.get("url"):
            return Video(str(data.get("id") or "video"), data.get("title") or "视频",
                         [data["url"]], data.get("http_headers", {}), cookies)
        raise DownloadError("该平台只提供分离的音视频流或需要登录，暂时无法给出可直接下载的链接。")

    def browser_resolve(self, wanted):
        from playwright.sync_api import Error as BrowserError, sync_playwright
        self.log("正在打开独立浏览器解析；如页面要求验证或登录，请在浏览器内完成。")
        with sync_playwright() as p:
            context = launch_browser(p)
            try:
                page = context.new_page()
                # Parsing only needs page/API metadata; do not cache video playback on the PC.
                network = context.new_cdp_session(page)
                network.send("Network.enable")
                network.send("Network.setBlockedURLs", {"urls": ["*.mp4*", "*douyinvod.com/*", "*bytevod.com/*", "*zjcdn.com/*", "*douyincdn.com/*", "*toutiaovod.com/*"]})
                found = []
                def receive(response):
                    if "/aweme/" in response.url and "application/json" in response.headers.get("content-type", ""):
                        try:
                            detail = walk_details(response.json(), wanted)
                            if detail:
                                found.append(from_detail(detail))
                        except Exception:
                            pass
                page.on("response", receive)
                target = f"https://www.douyin.com/video/{wanted}"
                try:
                    page.goto(target, wait_until="domcontentloaded", timeout=35000)
                except Exception as exc:
                    if page.is_closed():
                        raise DownloadError("浏览器已关闭，请重试")
                    self.log(f"阶段3 浏览器导航异常：{type(exc).__name__}: {_clean(exc, 140)}")
                deadline = time.monotonic() + self.browser_timeout
                verify_noted = False
                tick = 0
                while time.monotonic() < deadline:
                    check_cancel(self.cancel)
                    if page.is_closed():
                        raise DownloadError("浏览器已关闭，请重试")
                    if not found:
                        try:
                            content = page.content()
                        except BrowserError as exc:
                            if "navigat" in str(exc).lower():
                                page.wait_for_timeout(300)
                                continue
                            raise
                        info = detail_from_html(content, wanted)
                        if info:
                            found.append(info)
                    if found:
                        info = found[0]
                        info.headers = {"User-Agent": page.evaluate("navigator.userAgent"), "Referer": target}
                        info.cookies = browser_cookies(context.cookies())
                        self.log(f"阶段3 浏览器取得作品数据（页面 host={_host(page.url)}）")
                        return info
                    tick += 1
                    if not verify_noted and tick % 4 == 0:
                        try:
                            text = page.evaluate("document.body ? document.body.innerText.slice(0, 2000) : ''")
                            if any(mark in text for mark in ("安全验证", "滑动验证", "输入验证码", "请完成验证")):
                                verify_noted = True
                                self.log("阶段3 页面出现人工验证；无头浏览器无法自动完成，将等待超时")
                        except Exception:
                            pass
                    page.wait_for_timeout(500)
                try:
                    self.log(f"阶段3 超时未取得数据：停留在 host={_host(page.url)}，标题={_clean(page.title(), 60)!r}")
                except Exception:
                    pass
                raise DownloadError("未取得视频。请点击“登录抖音”，完成验证后关闭浏览器，再重试。作品也可能已删除、私密或不是视频。")
            finally:
                context.close()


def _env_proxy_url():
    """The environment's proxy for HTTPS (systemd EnvironmentFile or shell),
    following the usual lowercase-first convention."""
    for key in ("https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY", "http_proxy", "HTTP_PROXY"):
        value = os.environ.get(key)
        if value:
            return value
    return None


class _ConnectRelay:
    """Localhost CONNECT relay in front of the environment's HTTP proxy.

    Server evidence (2026-10-23): this host's egress gateway accepts CONNECT
    from Python/yt-dlp, but Chromium's direct CONNECT attempts die with
    ERR_TUNNEL_CONNECTION_FAILED before any HTTP response arrives, while the
    same request relayed through a local socket succeeds. So on proxied
    Linux hosts Chromium is pointed at this relay instead. Credentials in
    the proxy URL stay inside this process: the relay injects
    Proxy-Authorization itself, so neither Chromium nor the logs see them.
    """

    def __init__(self, upstream_url):
        parsed = urlparse(upstream_url)
        if parsed.scheme != "http" or not parsed.hostname:
            raise ValueError("unsupported proxy URL for relay")
        self._host = parsed.hostname
        self._port = parsed.port or 80
        self._auth = None
        if parsed.username:
            raw = f"{unquote(parsed.username)}:{unquote(parsed.password or '')}"
            self._auth = base64.b64encode(raw.encode("utf-8")).decode("ascii")
        self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server.bind(("127.0.0.1", 0))
        self._server.listen(16)
        self._closed = False
        self.port = self._server.getsockname()[1]
        threading.Thread(target=self._accept_loop, daemon=True).start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}"

    def close(self):
        self._closed = True
        try:
            self._server.close()
        except OSError:
            pass

    def _accept_loop(self):
        while not self._closed:
            try:
                client, _ = self._server.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(client,), daemon=True).start()

    def _upstream(self):
        last = None
        for family, socktype, proto, _, addr in socket.getaddrinfo(self._host, self._port, 0, socket.SOCK_STREAM):
            sock = socket.socket(family, socktype, proto)
            try:
                sock.settimeout(15)
                sock.connect(addr)
                return sock
            except OSError as exc:
                last = exc
                sock.close()
        raise last or OSError("cannot reach proxy")

    @staticmethod
    def _read_head(sock):
        data = b""
        while b"\r\n\r\n" not in data and len(data) < 65536:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
        head, _, rest = data.partition(b"\r\n\r\n")
        return head + b"\r\n\r\n", rest

    def _handle(self, client):
        upstream = None
        try:
            head, rest = self._read_head(client)
            if not head.strip():
                return
            if self._auth and b"proxy-authorization" not in head.lower():
                head = head[:-2] + f"Proxy-Authorization: Basic {self._auth}\r\n\r\n".encode("ascii")
            upstream = self._upstream()
            upstream.sendall(head + rest)
            rhead, rrest = self._read_head(upstream)
            client.sendall(rhead + rrest)

            def pump(src, dst):
                try:
                    while True:
                        chunk = src.recv(65536)
                        if not chunk:
                            break
                        dst.sendall(chunk)
                except OSError:
                    pass
                finally:
                    try:
                        dst.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass

            worker = threading.Thread(target=pump, args=(client, upstream), daemon=True)
            worker.start()
            pump(upstream, client)
            worker.join(timeout=5)
        except OSError:
            pass
        finally:
            for sock in (client, upstream):
                if sock is not None:
                    try:
                        sock.close()
                    except OSError:
                        pass


def launch_browser(playwright):
    DATA.mkdir(parents=True, exist_ok=True)
    errors = []
    # Windows keeps the original behaviour: a visible Edge/Chrome window the
    # user can log in to. Headless servers (Linux) have no display and usually
    # no Edge, so there we run Playwright's Chromium headlessly instead.
    # DOUYIN_BROWSER_HEADLESS=0/1 forces the mode on any platform.
    forced = os.environ.get("DOUYIN_BROWSER_HEADLESS")
    extra = {}
    relay = None
    if os.name == "nt" and forced is None:
        attempts = [{"channel": "msedge", "headless": False},
                    {"channel": "chrome", "headless": False}]
    else:
        headless = forced != "0" if forced is not None else os.name != "nt"
        attempts = [{"channel": "chrome", "headless": headless},
                    {"channel": "chromium", "headless": headless},
                    {"headless": headless}]
        if os.name == "nt":
            attempts.insert(0, {"channel": "msedge", "headless": headless})
        else:
            # Server mode: honour the environment's egress proxy via a
            # localhost relay (Chromium cannot CONNECT to this gateway
            # directly, see _ConnectRelay). The gateway also TLS-intercepts
            # with a platform CA that Chromium does not trust while Python
            # does (via SSL_CERT_FILE), so when that CA bundle is in play,
            # certificate errors are ignored for this metadata-only browser.
            proxy_url = _env_proxy_url()
            if proxy_url:
                try:
                    relay = _ConnectRelay(proxy_url)
                    extra["proxy"] = {"server": relay.url}
                except Exception:
                    extra["proxy"] = {"server": proxy_url}
                bypass = os.environ.get("no_proxy") or os.environ.get("NO_PROXY")
                if bypass:
                    extra["proxy"]["bypass"] = bypass
            if os.environ.get("DOUYIN_BROWSER_IGNORE_HTTPS_ERRORS") == "1" or os.environ.get("SSL_CERT_FILE"):
                extra["ignore_https_errors"] = True
    for options in attempts:
        try:
            context = playwright.chromium.launch_persistent_context(
                str(DATA / "browser-profile"), viewport={"width": 1100, "height": 760},
                accept_downloads=False,
                args=["--autoplay-policy=user-gesture-required"], **{**extra, **options})
            if relay is not None:
                context.on("close", relay.close)
            return context
        except Exception as exc:
            errors.append(f"{options.get('channel', 'chromium')}: {type(exc).__name__}: {_clean(exc, 100)}")
    if relay is not None:
        relay.close()
    raise DownloadError("无法启动浏览器：" + "；".join(errors) +
                        "。请安装 Edge、Chrome 或 Chromium（Linux 可运行 python -m playwright install chromium），并关闭本工具先前打开的抖音浏览器后重试。")


def browser_cookies(values):
    result = []
    for c in values:
        domain = c["domain"]
        result.append(http.cookiejar.Cookie(0, c["name"], c["value"], None, False, domain,
                     domain.startswith("."), domain.startswith("."), c["path"], True,
                     c["secure"], int(c["expires"]) if c.get("expires", -1) > 0 else None,
                     False, None, None, {}, False))
    return result


def login_browser(log, cancel):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        context = launch_browser(p)
        try:
            page = context.new_page()
            log("请在独立浏览器内登录抖音，完成后关闭浏览器窗口。登录状态会保存在本机。")
            try:
                page.goto("https://www.douyin.com/", wait_until="domcontentloaded", timeout=35000)
            except Exception:
                pass
            while context.pages:
                check_cancel(cancel)
                try:
                    context.pages[0].wait_for_timeout(500)
                except Exception:
                    break
        finally:
            try:
                context.close()
            except Exception:
                pass


def download_video(info, folder, progress, cancel, opener=None):
    folder = Path(folder).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    stem = f"{safe_name(info.title)}_{info.id}"
    if opener is None:
        jar = http.cookiejar.CookieJar()
        for cookie in info.cookies:
            jar.set_cookie(cookie)
        opener = build_opener(HTTPCookieProcessor(jar))
    last_error = None
    for url in info.urls:
        check_cancel(cancel)
        temp = folder / f".{stem}.{uuid.uuid4().hex[:8]}.part"
        try:
            headers = {"User-Agent": UA, "Referer": "https://www.douyin.com/", **info.headers,
                       "Accept-Encoding": "identity"}
            with opener.open(Request(url, headers=headers), timeout=20) as response:
                if response.status != 200:
                    raise DownloadError(f"视频服务器返回 HTTP {response.status}")
                total = int(response.headers.get("Content-Length") or 0)
                kind = response.headers.get("Content-Type", "").lower()
                if any(t in kind for t in ("text/", "json", "image/")):
                    raise DownloadError("视频地址返回了网页或图片，无法保存为视频")
                received, first, started = 0, b"", time.monotonic()
                with temp.open("xb") as output:
                    while True:
                        check_cancel(cancel)
                        chunk = response.read(256 * 1024)
                        if not chunk:
                            break
                        if not first:
                            first = chunk[:64]
                            if b"ftyp" not in first:
                                raise DownloadError("返回内容不是有效 MP4 视频")
                        output.write(chunk)
                        received += len(chunk)
                        progress(received, total, received / max(time.monotonic() - started, .01))
                if received < 32 or (total and received != total):
                    raise DownloadError("视频传输不完整，请重试")
            check_cancel(cancel)
            # Windows rename does not replace an existing file. Keep every completed copy.
            for n in range(10000):
                target = folder / f"{stem}{f' ({n})' if n else ''}.mp4"
                try:
                    if os.name != "nt" and target.exists():
                        continue
                    temp.rename(target)
                    return target
                except FileExistsError:
                    continue
            raise DownloadError("同名文件过多，请更换保存目录")
        except Cancelled:
            raise
        except Exception as exc:
            last_error = exc
        finally:
            temp.unlink(missing_ok=True)
    raise DownloadError("视频下载失败：网络中断或视频地址已过期，请重新解析后重试。") from last_error
