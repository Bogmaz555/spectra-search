"""Browser subresources, DNS rebinding, and the loopback egress proxy."""

from __future__ import annotations

import socket
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from egress import EgressProxy, classify_request, install_request_guard, pin_public_ip
from guard import GuardError


class PolicyTests(unittest.TestCase):
    def test_private_targets_are_denied_even_as_subresources(self) -> None:
        self.assertEqual(classify_request("http://169.254.169.254/latest/meta-data"), "deny")
        self.assertEqual(classify_request("http://127.0.0.1/steal"), "deny")
        self.assertEqual(classify_request("https://10.1.2.3/x"), "deny")
        self.assertEqual(classify_request("ws://127.0.0.1/socket"), "deny")
        self.assertEqual(classify_request("data:text/html,hi"), "skip")

    def test_dns_answer_with_a_private_address_is_not_pinned(self) -> None:
        def resolver(host, port, type=0):  # noqa: A002
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", port))]

        with self.assertRaises(GuardError):
            pin_public_ip("rebinding.example", 443, resolver=resolver)


class ProxyTests(unittest.TestCase):
    def test_connect_to_link_local_is_refused(self) -> None:
        proxy = EgressProxy()
        try:
            sock = socket.create_connection(("127.0.0.1", proxy._httpd.server_address[1]), timeout=3)
            sock.sendall(b"CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: 169.254.169.254:80\r\n\r\n")
            data = sock.recv(200)
            sock.close()
        finally:
            proxy.close()
        self.assertIn(b"403", data)
        self.assertTrue(any("169.254.169.254" in item for item in proxy.blocked))
        self.assertEqual(proxy.allowed, [])


class _Page(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/go-private"):
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data")
            self.end_headers()
            return
        body = (
            "<html><head><title>Hostile</title></head><body><h1>Hostile</h1>"
            "<img src='http://169.254.169.254/latest/meta-data'>"
            f"<script src='http://127.0.0.1:{STEAL_PORT}/steal.js'></script>"
            "</body></html>"
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        return


class _Steal(BaseHTTPRequestHandler):
    hits = 0

    def do_GET(self) -> None:  # noqa: N802
        _Steal.hits += 1
        self.send_response(200)
        self.end_headers()

    def log_message(self, fmt: str, *args) -> None:
        return


STEAL_PORT = 0


class BrowserSubresourceTests(unittest.TestCase):
    def test_private_subresources_and_redirect_are_not_fetched(self) -> None:
        global STEAL_PORT
        _Steal.hits = 0
        steal = ThreadingHTTPServer(("127.0.0.1", 0), _Steal)
        STEAL_PORT = steal.server_address[1]
        page = ThreadingHTTPServer(("127.0.0.1", 0), _Page)
        threads = [
            threading.Thread(target=steal.serve_forever, daemon=True),
            threading.Thread(target=page.serve_forever, daemon=True),
        ]
        for thread in threads:
            thread.start()
        blocked: list[str] = []
        try:
            from scrapling.fetchers import StealthyFetcher

            origin = f"http://127.0.0.1:{page.server_address[1]}/"
            StealthyFetcher.fetch(
                origin,
                headless=True,
                timeout=15000,
                network_idle=False,
                retries=1,
                block_webrtc=True,
                google_search=False,
                page_setup=lambda browser_page: install_request_guard(
                    browser_page, blocked, allow_prefixes=(origin,)
                ),
            )
            with self.assertRaises(Exception):
                StealthyFetcher.fetch(
                    origin + "go-private",
                    headless=True,
                    timeout=4000,
                    network_idle=False,
                    retries=1,
                    block_webrtc=True,
                    google_search=False,
                    page_setup=lambda browser_page: install_request_guard(
                        browser_page, blocked, allow_prefixes=(origin,)
                    ),
                )
        finally:
            page.shutdown()
            steal.shutdown()
        self.assertEqual(_Steal.hits, 0)
        self.assertTrue(any("169.254.169.254" in item for item in blocked))


if __name__ == "__main__":
    unittest.main()
