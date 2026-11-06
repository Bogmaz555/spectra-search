"""Compare a plain HTTP download with Scrapling on the same public URLs.

Run from this directory with PYTHONPATH pointing at the scrapling install:

    PYTHONPATH=/path/to/site-packages python3 compare.py
"""

from __future__ import annotations

import json
import resource
import time
import urllib.request
from pathlib import Path

from extract import extract_url

URLS = [
    "https://example.com/",
    "https://quotes.toscrape.com/",
    "https://quotes.toscrape.com/js/",
]
MARKER = "The world as we have created it is a process of our thinking"


def baseline(url: str) -> dict:
    started = time.perf_counter()
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "SPECTRA-baseline/1.0", "Accept": "text/html"},
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        body = response.read(1_500_000)
        status = response.status
        final = response.geturl()
    text = body.decode("utf-8", errors="replace")
    return {
        "ok": True,
        "status": status,
        "final_url": final,
        "text_chars": len(text),
        "marker_present": MARKER in text,
        "duration_ms": int((time.perf_counter() - started) * 1000),
    }


def slim(result: dict) -> dict:
    text = result.get("text") or ""
    return {
        "ok": result.get("ok"),
        "library": result.get("library"),
        "mode": result.get("mode"),
        "status": result.get("status"),
        "final_url": result.get("final_url"),
        "title": result.get("title"),
        "quote_count": len(result.get("quotes") or []),
        "first_quote": (result.get("quotes") or [None])[0],
        "text_chars": result.get("text_chars"),
        "marker_present": MARKER in text,
        "duration_ms": result.get("duration_ms"),
        "error": result.get("error"),
    }


def main() -> None:
    rows = []
    for url in URLS:
        row = {"url": url, "baseline": None, "scrapling_http": None, "scrapling_browser": None}
        try:
            row["baseline"] = baseline(url)
        except Exception as exc:
            row["baseline"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:300]}
        for mode, key in (("http", "scrapling_http"), ("browser", "scrapling_browser")):
            try:
                row[key] = slim(extract_url(url, mode))
            except Exception as exc:
                row[key] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:300]}
        rows.append(row)
    usage = resource.getrusage(resource.RUSAGE_SELF)
    summary = {
        "docker_executed": False,
        "note": "Compared in this process. Docker was not installed, so the image was not run.",
        "max_rss_kb": usage.ru_maxrss,
        "rows": rows,
    }
    out = Path(__file__).resolve().parent / "evidence" / "compare.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
