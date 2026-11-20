"""Local Scrapling worker. Listens on 127.0.0.1 unless explicitly inside Docker.

Docker must publish the port as 127.0.0.1:8765:8765. There is no tunnel and no public bind
on the host. The process accepts 0.0.0.0 only when WORKER_IN_DOCKER=1, which the
compose file sets so the port publish can reach the container network namespace.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from extract import extract_url
from guard import GuardError

MAX_BODY = 4_096
_job = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    server_version = "spectra-scrapling-worker/0.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/health":
            self._send(404, {"ok": False, "error": "Nieznana ścieżka"})
            return
        self._send(200, {"ok": True, "bind": "loopback-or-docker-namespace"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/v1/extract":
            self._send(404, {"ok": False, "error": "Nieznana ścieżka"})
            return
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > MAX_BODY:
            self._send(400, {"ok": False, "error": "Za duże albo puste żądanie"})
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            self._send(400, {"ok": False, "error": "JSON jest niepoprawny"})
            return
        if not isinstance(data, dict):
            self._send(400, {"ok": False, "error": "Obiekt JSON"})
            return
        url = data.get("url")
        mode = data.get("mode") or "http"
        if not isinstance(url, str) or not isinstance(mode, str):
            self._send(400, {"ok": False, "error": "url i mode muszą być tekstem"})
            return
        if not _job.acquire(blocking=False):
            self._send(429, {"ok": False, "error": "Jedno zadanie naraz"})
            return
        try:
            result = extract_url(url, mode)
        except GuardError as exc:
            self._send(400, {"ok": False, "error": str(exc)})
            return
        finally:
            _job.release()
        self._send(200 if result.get("ok") else 502, result)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Scrapling worker")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    in_docker = os.environ.get("WORKER_IN_DOCKER") == "1"
    if args.host not in {"127.0.0.1", "::1"} and not (in_docker and args.host == "0.0.0.0"):
        raise SystemExit("Odmowa: worker słucha tylko 127.0.0.1 (albo 0.0.0.0 wyłącznie z WORKER_IN_DOCKER=1)")
    if not 1 <= args.port <= 65535:
        raise SystemExit("Zły port")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"listening http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
