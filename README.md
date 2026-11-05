# SPECTRA — wyszukiwanie wieloźródłowe

Portal wyszukiwania: darmowe źródła discovery, równoległy crawl stron i uczciwe adaptery dla nazwanych silników. Opcjonalnie **Grok (xAI)** syntezuje odpowiedź.

Darmowa ścieżka działa bez płatnych kluczy.

## Co jest prawdziwe

| Warstwa | Zachowanie |
| --- | --- |
| Discovery | DuckDuckGo HTML + Lite, Wikipedia PL/EN/DE, Wikidata, Hacker News, Stack Overflow, arXiv, GitHub |
| Opcjonalne wyszukiwarki | Brave (`BRAVE_SEARCH_API_KEY`), Serper (`SERPER_API_KEY`) — pomijane bez klucza |
| Crawl | Własna kolejka: deduplikacja URL, limit hostów, współbieżność, budżet czasu, robots.txt, odrzucanie adresów prywatnych |
| Ekstrakcja | Cheerio: markdown, meta, linki, media, heurystyka list |
| Firecrawl | Prawdziwe `POST /v1/scrape`, tylko z `FIRECRAWL_API_KEY` |
| Browser Use | `fetch.browser-use.com`, tylko z kluczem i tylko przy blokadzie / pustej stronie |
| Crawl4AI | Chmura albo self-host `/md`, gdy ustawiony klucz lub `CRAWL4AI_BASE_URL` |

## Czego tu nie ma (i status to mówi)

| Adapter | Dlaczego |
| --- | --- |
| curl-impersonate | Brak binarki TLS/JA3. Zostają nagłówki Chrome — status **aproksymacja**. |
| Scrapling | Biblioteka Pythona nie jest uruchamiana. Jest retry i detekcja blokad — **aproksymacja**. |
| AutoScraper | Brak uczenia z przykładu. Heurystyka CSS — **aproksymacja**. |
| MarkItDown | Brak konwersji PDF/Office. Jest normalizacja Markdown — **aproksymacja**. |
| Crawl4AI bez klucza | Lokalny HTML→Markdown — **aproksymacja**. |
| Crawlee | Worker Apify / Playwright nie mieści się w funkcji serverless — **pominięty**. Kolejkę robi SPECTRA. |
| Scrapy | Proces Pythona (Twisted) — **pominięty**. |
| scrcpy | Wymaga ADB i Androida — **pominięty**. Viewport strony nie jest scrcpy. |
| Browser Use bez klucza | **Pominięty**. Analiza DOM nie jest Browser Use. |
| Firecrawl bez klucza | **Pominięty**. Lokalne pola meta nie są Firecrawlem. |

## Stack

- React 19 + TanStack Start / Router
- Vite 8 + Tailwind v4
- Cheerio
- Better Auth
- Vercel (Nitro, `maxDuration` 180s)

## Lokalnie

```bash
npm install
npm run dev
npm run build
npm run typecheck
npm test
```

## Zmienne środowiskowe

Wszystkie klucze są opcjonalne. Opis każdego jest w [`.env.example`](.env.example). Nie commituj sekretów — ustaw je w Vercel → Project → Settings → Environment Variables.

Skala jednego zapytania: do 36 złączonych trafień, domyślnie 6 stron w trybie Szukaj i 10 w Deep, współbieżność 3, budżet crawla około 45 s. Synteza Grok ma osobny limit 90 s (limit funkcji 180 s).

## Tryby

- **Auto** — URL albo zapytanie
- **Szukaj** — discovery + scrape zróżnicowanych hostów
- **URL** — jedna publiczna strona
- **Deep** — więcej stron i linki wewnętrzne
- **Firma / CapEx** — nazwa, KRS, NIP albo URL. Google News RSS, pięć szablonów `site:` (WNP, Puls Biznesu, Automatyka B2B, Opakowanie, Magazyn Przemysłowy) i cztery ścieżki firmy (`/aktualnosci`, `/inwestycje`, `/o-nas`, `/kontakt`) tylko gdy odpowiedzą HTTP 200. Deep link: `/?mode=capex&q=...`

Odpis KRS idzie z publicznego `api-krs.ms.gov.pl` (zarząd i prokurenci; PESEL nie trafia do karty). NIP spółki jest zamieniany na KRS przez publiczny wykaz VAT, bez klucza. **CEIDG (JDG) nie jest podłączone** — token Biznes.gov.pl wymaga osobnego OK. Sam NIP bez numeru KRS nie wciąga danych osoby fizycznej.

## Licencja

Kod aplikacji — projekt własny. Projekty zewnętrzne mają własne licencje (MIT, Apache-2.0, AGPL itd.) i nie są tu bundle’owane, chyba że wołasz ich API własnym kluczem.
