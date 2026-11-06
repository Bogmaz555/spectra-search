# Local Scrapling worker

A separate prototype from the search app. It runs [Scrapling 0.5.1](https://github.com/D4Vinci/Scrapling) (BSD), not a Cheerio lookalike.

- `http` mode: `scrapling.fetchers.Fetcher` (curl_cffi browser impersonation). It does not run page JavaScript.
- `browser` mode: `scrapling.fetchers.StealthyFetcher` (Patchright Chromium). It does run page JavaScript.

No API key, no paid host, no tunnel. The process listens on `127.0.0.1` only. Docker may listen on all interfaces inside the container network, and the compose file publishes **only** `127.0.0.1:8765`.

## What was actually run

The review machine had no `docker` binary. The image was **not** built and **not** started. Numbers below are from a local process with packages installed under an isolated directory (`pip install --target`), not from a container.

Measured on that run (see `evidence/compare.json`):

| URL | Plain `urllib` | Scrapling HTTP (`Fetcher`) | Scrapling browser (`StealthyFetcher`) |
| --- | --- | --- | --- |
| `https://example.com/` | 577 bytes, 71 ms. The title is in the file. | 200 in 176 ms. Parsed title `Example Domain`. Visible text 171 chars. No extra facts. | 200 in 1161 ms. Same title. No extra facts. |
| `https://quotes.toscrape.com/` | 11021 bytes, 114 ms. The quote sentence is already in the HTML. | 200 in 227 ms. CSS `.quote .text` returns **10** quote strings. | 200 in 1434 ms. Same 10 quote strings. |
| `https://quotes.toscrape.com/js/` | 5806 bytes, 112 ms. A string search finds the sentence inside the page source. | 200 in 171 ms. Visible text 130 chars. CSS finds **0** quote nodes. | 200 in 1384 ms. CSS finds **10** quote nodes after JavaScript runs. |

`max_rss_kb` in the JSON (61416) is only the Python process. A separate sample of Python plus Chrome during one browser fetch peaked at about **1.2 GB** (`browser_peak_rss_kb`). The compose file caps the container at 2 GB. One request at a time. HTTP timeout 12s, browser timeout 20s, at most 4 redirects, no retries.

## Run locally without Docker

```bash
cd workers/scrapling
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m patchright install chromium   # only for browser mode
PYTHONPATH=. .venv/bin/python worker.py --host 127.0.0.1 --port 8765
```

Another shell:

```bash
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/v1/extract \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/","mode":"http"}'
```

`--host 0.0.0.0` exits unless `WORKER_IN_DOCKER=1`.

Checks:

```bash
cd workers/scrapling
PYTHONPATH=. python3 -m unittest test_guard.py
PYTHONPATH=. python3 compare.py
```

## Docker (not executed in review)

```bash
cd workers/scrapling
docker compose up --build
```

Then use `http://127.0.0.1:8765` from the same machine. Do not publish `0.0.0.0:8765` and do not add a tunnel.

## Safety

Before Scrapling is called, the URL must be `http` or `https`, must not contain a username or password, and every DNS answer must be a public address. Loopback, private, link-local, and mapped IPv6 loopback are rejected. Scrapling is called with `follow_redirects="safe"` and `max_redirects=4`, which is that library's own block on redirects to private addresses. After the response, the final URL and redirect history are checked again; a private hop drops the body.

The worker does not crawl further links. It does not read or return API keys.

## Not in this prototype

curl-impersonate (the C binary), Crawlee, Scrapy, AutoScraper, Crawl4AI, MarkItDown, Firecrawl, Browser Use, and scrcpy are not started. Scrapling's HTTP mode is the closest real fetcher available here; it is not the curl-impersonate binary. Browser mode is Chromium via Patchright, not a hosted browser service.
