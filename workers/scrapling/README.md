# Local Scrapling worker

A separate prototype from the search app. It runs [Scrapling 0.5.1](https://github.com/D4Vinci/Scrapling) (BSD), not a Cheerio lookalike.

- `http` mode: `scrapling.fetchers.Fetcher` (curl_cffi browser impersonation). It does not run page JavaScript.
- `browser` mode: `scrapling.fetchers.StealthyFetcher` (Patchright Chromium). It does run page JavaScript.

No API key, no paid host, no tunnel. The process listens on `127.0.0.1` only. Docker may listen on all interfaces inside the container network, and the compose file publishes **only** `127.0.0.1:8765`.

## What was actually run

The review machine had no `docker` binary. The image was **not** built and **not** started. Numbers below are from a local process with packages installed under an isolated directory (`pip install --target`), not from a container.

Measured against public company pages and one JavaScript fixture (see `evidence/compare.json`). Plain `urllib` returns the raw file. Scrapling returns visible text plus fields it parsed.

| URL | Plain download | Scrapling HTTP | Scrapling browser |
| --- | --- | --- | --- |
| `https://pl.wikipedia.org/wiki/Mlekovita` | 138967 bytes in 41 ms. The facts are inside the HTML and are not fields. | 200 in 302 ms. Infobox: ul. Ludowa 122, Wysokie Mazowieckie; president Dariusz Sapiński; KRS 0000074309; employment 5300 (2025). | 200 in 1971 ms. The same four fields and about 800 more characters. No new fact. |
| `https://mlekovita.com.pl/` | 526122 bytes in 674 ms. | 200 in 643 ms. Title “MLEKOVITA – Twoja mleczna droga”. About 45k characters of visible text. No separate investment record. | 200 in 6033 ms. About 48k characters. No additional structured investment fact. |
| `https://www.tygodnik-rolniczy.pl` | 398964 bytes in 490 ms. Publisher home page named by Google News RSS, not one article. | 200 in 554 ms. About 23k characters of visible text. | 200 in 5684 ms. About 23k characters. No extra article. |
| `https://investmap.pl/` | Follow-up call, not the first loop. | 200 in 1426 ms. Property-market title. 9708 visible characters. | 200 in 15225 ms. 9814 characters. The only extra visible line was the cookie notice. |
| `https://quotes.toscrape.com/js/` | 5806 bytes. The sentence is in the source, not as quote nodes. | CSS finds 0 quote nodes. | CSS finds 10 quote nodes in about 1s. This is where the browser adds structure. |

Python-only RSS in the comparison was about 70 MB and does **not** include Chromium. A separate sample of Python plus Chrome during one browser fetch peaked at about **1.2 GB**. The compose file caps the container at 2 GB. One request at a time. HTTP timeout 12s, browser timeout 20s, at most 4 redirects, no retries.

On these company pages the useful structured record came from the HTTP parser. The browser was slower and, apart from the JavaScript fixture, did not add an investment fact.

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

Checking only the address the user typed is not enough. A public page can still ask the browser for `169.254.169.254`, another loopback port, or a name that resolves to a private address.

Browser mode therefore does three things:

- a route installed before navigation aborts any request that is not public HTTP(S) or WebSocket
- Chromium is pointed at a proxy on `127.0.0.1` that resolves the name again and opens the socket only to that public IP
- WebRTC is forced through the proxy, DNS prefetch is disabled, and images, fonts, and media are not downloaded

HTTP mode does not run subresources. It uses Scrapling's `follow_redirects="safe"` (curl refuses a redirect onto a private IP) and the same public-address check on the final URL. One job at a time. Address length is capped at 2048 characters. Returned text is capped at 100000 characters. The proxy allows at most 12 connections and 1.5 MB through each tunnel.

How this could later sit next to hosted Spectra, and why Vercel must not dial the laptop, is in `INTEGRATION.md`. That wiring is not implemented.

## Docker

`docker` is not installed in the environment that produced `evidence/compare.json`. The image was not built. Do not read the Dockerfile as a passed build. The apt package list is a best-effort set for Chromium and was not executed.

## Not in this prototype

curl-impersonate (the C binary), Crawlee, Scrapy, AutoScraper, Crawl4AI, MarkItDown, Firecrawl, Browser Use, and scrcpy are not started. Scrapling's HTTP mode is the closest real fetcher available here; it is not the curl-impersonate binary. Browser mode is Chromium via Patchright, not a hosted browser service.
