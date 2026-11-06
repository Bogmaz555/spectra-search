"""SSRF and bind checks. No paid services."""

from __future__ import annotations

import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from guard import GuardError, assert_public_url


class GuardTests(unittest.TestCase):
    def test_rejects_private_and_local_targets(self) -> None:
        for url in (
            "http://127.0.0.1/",
            "http://169.254.169.254/latest/meta-data",
            "http://10.1.2.3/",
            "http://localhost/admin",
            "file:///etc/passwd",
            "http://user:pass@example.com/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
        ):
            with self.subTest(url=url):
                with self.assertRaises(GuardError):
                    assert_public_url(url)

    def test_dns_to_loopback_is_rejected(self) -> None:
        # nip.io is a public DNS name that answers with the embedded address.
        with self.assertRaises(GuardError):
            assert_public_url("http://127.0.0.1.nip.io/latest")

    def test_worker_refuses_non_loopback_without_docker_flag(self) -> None:
        import os
        import subprocess
        import sys

        env = os.environ.copy()
        env.pop("WORKER_IN_DOCKER", None)
        env["PYTHONPATH"] = os.pathsep.join(
            [os.path.dirname(__file__), env.get("PYTHONPATH", "")]
        )
        proc = subprocess.run(
            [sys.executable, "worker.py", "--host", "0.0.0.0", "--port", "9"],
            cwd=os.path.dirname(__file__),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("127.0.0.1", proc.stderr + proc.stdout)


class _Redirect(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        self.send_response(302)
        self.send_header("Location", "http://169.254.169.254/latest/meta-data")
        self.end_headers()

    def log_message(self, fmt: str, *args) -> None:
        return


class LibraryRedirectTests(unittest.TestCase):
    def test_scrapling_safe_mode_does_not_return_link_local_body(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Redirect)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            from scrapling.fetchers import Fetcher

            try:
                page = Fetcher.get(
                    f"http://127.0.0.1:{port}/go",
                    timeout=5,
                    follow_redirects="safe",
                    max_redirects=3,
                    retries=0,
                    stealthy_headers=False,
                )
            except Exception as exc:
                self.assertNotIn("meta-data", str(exc).lower())
                return
            body = str(getattr(page, "body", b""))
            self.assertNotIn("meta-data", body.lower())
            final = str(getattr(page, "url", ""))
            self.assertNotIn("169.254.169.254", final)
        finally:
            server.shutdown()


class ServerTests(unittest.TestCase):
    def test_localhost_extract_and_private_rejection(self) -> None:
        from worker import Handler

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.assertEqual(server.server_address[0], "127.0.0.1")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        try:
            health = urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5)
            self.assertEqual(json.load(health)["ok"], True)
            payload = json.dumps({"url": "http://169.254.169.254/latest/meta-data", "mode": "http"}).encode()
            request = urllib.request.Request(
                f"http://127.0.0.1:{port}/v1/extract",
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request, timeout=5)
            self.assertEqual(caught.exception.code, 400)
            body = json.loads(caught.exception.read().decode())
            self.assertIn("publiczny", body["error"])
        finally:
            server.shutdown()


if __name__ == "__main__":
    unittest.main()
