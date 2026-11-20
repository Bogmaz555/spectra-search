"""Stop Chromium from using a public page as a bridge to a private network.

Top-level URL checks are not enough: the page can request images, scripts, XHR,
WebSockets, or a redirect whose target is loopback, link-local, or a name that
resolves to a private address. Two layers run for browser mode:

- a Playwright route that aborts the request before it is sent
- a loopback HTTP proxy that resolves again and connects only to the public IP
  it just accepted, so a later DNS answer cannot move the socket
"""

from __future__ import annotations

import select
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from guard import GuardError, assert_public_url, is_public_ip

MAX_TUNNEL_BYTES = 1_500_000
MAX_CONNECTIONS = 12
CONNECT_TIMEOUT_S = 8


def classify_request(url: str) -> str:
    """Return allow, skip (no network), or deny."""
    parsed = urlsplit(url or "")
    if parsed.scheme in {"data", "blob", "about"}:
        return "skip"
    try:
        assert_public_url(url)
    except GuardError:
        return "deny"
    return "allow"


def pin_public_ip(host: str, port: int, resolver=socket.getaddrinfo) -> str:
    """Resolve now and return one public IP. Any private answer rejects the host.

    The socket is opened to this IP, not to the name, so a DNS change after the
    check cannot move the connection onto a private address.
    """
    literal = host.strip("[]")
    try:
        if is_public_ip(literal):
            return literal
        raise GuardError("Adres IP nie jest publiczny")
    except ValueError:
        pass
    try:
        infos = resolver(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise GuardError("DNS nie powiódł się") from exc
    if not infos:
        raise GuardError("DNS nie zwrócił adresu")
    chosen = ""
    for info in infos:
        addr = str(info[4][0]).split("%", 1)[0]
        try:
            if not is_public_ip(addr):
                raise GuardError("DNS wskazuje adres prywatny")
        except ValueError as exc:
            raise GuardError("DNS zwrócił nieznany adres") from exc
        if not chosen:
            chosen = addr
    return chosen


class EgressProxy:
    def __init__(self) -> None:
        self.blocked: list[str] = []
        self.allowed: list[str] = []
        self._lock = threading.Lock()
        self._open = 0
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, fmt: str, *args) -> None:
                return

            def _reject(self, code: int, target: str) -> None:
                with proxy._lock:
                    proxy.blocked.append(target)
                try:
                    self.send_error(code, "blocked")
                except OSError:
                    return

            def _acquire(self) -> bool:
                with proxy._lock:
                    if proxy._open >= MAX_CONNECTIONS:
                        return False
                    proxy._open += 1
                    return True

            def _release(self) -> None:
                with proxy._lock:
                    proxy._open = max(0, proxy._open - 1)

            def do_CONNECT(self) -> None:  # noqa: N802
                target = self.path
                if not self._acquire():
                    self._reject(503, target)
                    return
                try:
                    host, _, port_s = target.partition(":")
                    port = int(port_s or "443")
                    ip = pin_public_ip(host, port)
                    remote = socket.create_connection((ip, port), timeout=CONNECT_TIMEOUT_S)
                except (GuardError, OSError, ValueError):
                    self._reject(403, target)
                    self._release()
                    return
                with proxy._lock:
                    proxy.allowed.append(target)
                try:
                    self.send_response(200, "Connection Established")
                    self.end_headers()
                    _relay(self.connection, remote, MAX_TUNNEL_BYTES)
                finally:
                    remote.close()
                    self._release()

            def do_GET(self) -> None:  # noqa: N802
                self._http("GET")

            def do_POST(self) -> None:  # noqa: N802
                self._http("POST")

            def _http(self, method: str) -> None:
                target = self.path
                if not self._acquire():
                    self._reject(503, target)
                    return
                try:
                    parsed = urlsplit(target)
                    if classify_request(target) != "allow" or not parsed.hostname:
                        raise GuardError("blocked")
                    port = parsed.port or (443 if parsed.scheme == "https" else 80)
                    ip = pin_public_ip(parsed.hostname, port)
                    remote = socket.create_connection((ip, port), timeout=CONNECT_TIMEOUT_S)
                except (GuardError, OSError, ValueError):
                    self._reject(403, target)
                    self._release()
                    return
                with proxy._lock:
                    proxy.allowed.append(target)
                try:
                    path = parsed.path or "/"
                    if parsed.query:
                        path = f"{path}?{parsed.query}"
                    header_lines = [f"{method} {path} HTTP/1.1", f"Host: {parsed.hostname}"]
                    for key, value in self.headers.items():
                        if key.lower() in {"host", "proxy-connection", "proxy-authorization"}:
                            continue
                        header_lines.append(f"{key}: {value}")
                    remote.sendall(("\r\n".join(header_lines) + "\r\n\r\n").encode())
                    _relay(self.connection, remote, MAX_TUNNEL_BYTES)
                finally:
                    remote.close()
                    self._release()

        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    @property
    def url(self) -> str:
        host, port = self._httpd.server_address
        return f"http://{host}:{port}"

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()

    def __enter__(self) -> "EgressProxy":
        return self

    def __exit__(self, *args) -> None:
        self.close()


def _relay(left: socket.socket, right: socket.socket, limit: int) -> None:
    left.setblocking(False)
    right.setblocking(False)
    sockets = [left, right]
    transferred = 0
    while transferred < limit:
        readable, _, _ = select.select(sockets, [], [], CONNECT_TIMEOUT_S)
        if not readable:
            return
        for sock in readable:
            other = right if sock is left else left
            try:
                chunk = sock.recv(16_384)
            except OSError:
                return
            if not chunk:
                return
            transferred += len(chunk)
            if transferred > limit:
                return
            try:
                other.sendall(chunk)
            except OSError:
                return


def install_request_guard(page, blocked: list[str], allow_prefixes: tuple[str, ...] = ()) -> None:
    """Abort browser requests whose URL is not public. Runs before navigation.

    `allow_prefixes` exists only so a local test page can load while its private
    subresources stay blocked. Production calls pass none.
    """

    def handle(route) -> None:
        target = route.request.url
        if allow_prefixes and target.startswith(allow_prefixes):
            route.fallback()
            return
        kind = classify_request(target)
        if kind == "deny":
            blocked.append(target)
            route.abort("blockedbyclient")
            return
        route.fallback()

    page.route("**/*", handle)
