# SPECTRA — wyszukiwanie wieloźródłowe

Portal wyszukiwania: źródła danych, potem własne pobranie stron. Opcjonalnie **Grok (xAI)** syntezuje odpowiedź.

Darmowa ścieżka działa bez płatnych kluczy. Ekran skanu nie reklamuje dziesięciu bibliotek jako integracji.

Kaskada: odkrywanie → tanie pobranie → płatny fallback tylko dla cienkiej strony → ograniczone zejście → ekstrakcja → pokrycie tokenów i opcjonalny Grok (`grok-4.3`). Szczegóły wdrożeń, których tu nie ma (curl-impersonate, Scrapling, Crawlee, Scrapy, AutoScraper, MarkItDown, scrcpy), są w [`docs/cascade-roadmap.md`](docs/cascade-roadmap.md).

## Co jest prawdziwe

| Warstwa | Zachowanie |
| --- | --- |
| Discovery bez klucza | Wikipedia PL/EN/DE, Wikidata, Hacker News, Stack Overflow, arXiv, GitHub. DuckDuckGo HTML i Lite są próbą scrapingu — z Vercel często 403 albo strona blokady; błąd tego źródła nie wyłącza reszty |
| SerpAPI | Opcjonalne `SERPAPI_API_KEY`. Google (i część newsów CapEx). Limit na skan, żeby nie zjadać darmowego planu. Bez klucza pomijane |
| Inne wyszukiwarki | Brave (`BRAVE_SEARCH_API_KEY`), Serper (`SERPER_API_KEY`) — pomijane bez klucza |
| Firma / CapEx | KRS (`api-krs.ms.gov.pl`), ścieżki firmy, Google News RSS, prasa `site:`. Pusta odpowiedź nie jest błędem; awaria transportu jest |
| Crawl | Własna kolejka: deduplikacja URL, limit hostów, współbieżność, budżet czasu, robots.txt, odrzucanie adresów prywatnych |
| Ekstrakcja | Cheerio: markdown, meta, linki, media, heurystyka list. Status **krok lokalny**, nie nazwa cudzej biblioteki |
| Firecrawl | Prawdziwe `POST /v1/scrape`, tylko z `FIRECRAWL_API_KEY` |
| Browser Use | `fetch.browser-use.com`, tylko z kluczem i tylko przy blokadzie / pustej stronie |
| Crawl4AI | Chmura albo self-host `/md`, gdy ustawiony klucz lub `CRAWL4AI_BASE_URL`. Inaczej lokalny markdown |

## Czego skan nie pokazuje jako działającego

| Nazwa | Dlaczego |
| --- | --- |
| curl-impersonate | Brak binarki TLS/JA3. Zostają nagłówki Chrome — krok lokalny „Pobranie HTTP”. |
| Scrapling | Biblioteka Pythona nie jest uruchamiana. Jest detekcja blokady, a gdy jej nie ma — status „nie dotyczy”. |
| AutoScraper | Brak uczenia z przykładu. Heurystyka CSS, albo „nie dotyczy”, gdy nie ma listy. |
| MarkItDown | Brak konwersji PDF/Office. Jest normalizacja Markdown. |
| Crawl4AI bez klucza | Lokalny HTML→Markdown. |
| Crawlee | Worker Apify / Playwright nie mieści się w funkcji serverless. Kolejkę robi SPECTRA. Poza ekranem skanu. |
| Scrapy | Proces Pythona. Poza ekranem skanu. |
| scrcpy | ADB i Android. Nie ma związku z wyszukiwaniem stron i nie pojawia się w skanie. |
| Browser Use bez klucza | Pominięte. Analiza DOM nie jest Browser Use. |
| Firecrawl bez klucza | Pominięte. Lokalne pola meta nie są Firecrawlem. |

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
