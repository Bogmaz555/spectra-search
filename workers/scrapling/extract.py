"""One bounded Scrapling fetch. This imports the real library, not a reimplementation."""

from __future__ import annotations

import time
from typing import Any

from guard import GuardError, assert_public_url

MAX_TEXT = 100_000
HTTP_TIMEOUT_S = 12
BROWSER_TIMEOUT_MS = 20_000
MAX_REDIRECTS = 4

def _as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _history_urls(page: Any) -> list[str]:
    urls: list[str] = []
    for hop in getattr(page, "history", None) or []:
        hop_url = getattr(hop, "url", None)
        if hop_url:
            urls.append(str(hop_url))
    final = getattr(page, "url", None)
    if final:
        urls.append(str(final))
    return urls


def extract_url(url: str, mode: str = "http") -> dict[str, Any]:
    """Fetch one public URL with Scrapling and return text plus structured fields.

    `http` uses curl_cffi via Fetcher (browser impersonation, no page JS).
    `browser` uses StealthyFetcher (Patchright Chromium) and does run page JS.
    """
    if mode not in {"http", "browser"}:
        raise GuardError("Tryb musi być http albo browser")
    checked = assert_public_url(url)
    started = time.perf_counter()
    try:
        if mode == "http":
            from scrapling.fetchers import Fetcher

            page = Fetcher.get(
                checked,
                timeout=HTTP_TIMEOUT_S,
                follow_redirects="safe",
                max_redirects=MAX_REDIRECTS,
                retries=0,
                stealthy_headers=True,
            )
            library = "scrapling.fetchers.Fetcher"
        else:
            from scrapling.fetchers import StealthyFetcher

            page = StealthyFetcher.fetch(
                checked,
                headless=True,
                timeout=BROWSER_TIMEOUT_MS,
                follow_redirects="safe",
                max_redirects=MAX_REDIRECTS,
                network_idle=True,
            )
            library = "scrapling.fetchers.StealthyFetcher"
    except GuardError:
        raise
    except Exception as exc:
        return {
            "ok": False,
            "library": "scrapling",
            "mode": mode,
            "url": checked,
            "error": f"{type(exc).__name__}: {exc}"[:300],
            "duration_ms": int((time.perf_counter() - started) * 1000),
        }

    try:
        for hop in _history_urls(page):
            assert_public_url(hop)
    except GuardError as exc:
        return {
            "ok": False,
            "library": library,
            "mode": mode,
            "url": checked,
            "error": f"Odrzucono wynik: {exc}",
            "duration_ms": int((time.perf_counter() - started) * 1000),
        }

    quotes = [_as_text(item) for item in page.css(".quote .text::text").getall()]
    headings = [_as_text(item) for item in page.css("h1::text").getall()][:8]
    title = _as_text(page.css("title::text").get())
    description = _as_text(page.css("meta[name=description]::attr(content)").get())
    text = _as_text(page.get_all_text())
    truncated = len(text) > MAX_TEXT
    if truncated:
        text = text[:MAX_TEXT]
    links = []
    for node in page.css("a")[:30]:
        href = _as_text(node.attrib.get("href") if getattr(node, "attrib", None) else "")
        label = _as_text(node.get_all_text())[:160]
        if href:
            links.append({"href": href, "text": label})

    return {
        "ok": True,
        "library": library,
        "mode": mode,
        "url": checked,
        "final_url": _as_text(getattr(page, "url", checked)),
        "status": int(getattr(page, "status", 0) or 0),
        "title": title[:300],
        "description": description[:500],
        "headings": headings,
        "quotes": quotes[:20],
        "link_count": len(links),
        "links": links,
        "text_chars": len(text),
        "text_truncated": truncated,
        "text": text,
        "duration_ms": int((time.perf_counter() - started) * 1000),
        "error": None,
    }
