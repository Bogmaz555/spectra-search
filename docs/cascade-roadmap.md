# Kaskada badania — co działa teraz i co wymaga osobnego wdrożenia

Ten dokument oddziela kod w tym repozytorium od rzeczy, których świadomie nie udajemy.
Żaden z poniższych kroków nie wymaga zakupu nowej usługi, żeby darmowa ścieżka działała.

## Zaimplementowane teraz

Kolejność jest stała. Płatne wywołanie startuje tylko wtedy, gdy poprzedni etap nie dał treści.

| Etap | Co realnie się dzieje | Czego ten etap nie jest |
| --- | --- | --- |
| Odkrywanie | Wikipedia PL/EN/DE, Wikidata, GitHub, Hacker News, Stack Overflow, arXiv. DuckDuckGo HTML i Lite jako scraping (z Vercel często 403 — błąd tylko tego źródła). SerpAPI, Brave i Serper wyłącznie z kluczem, z limitem wywołań SerpAPI na skan. CapEx dokłada KRS, ścieżki firmy, Google News RSS i prasę `site:`. | Nie jest dziesięcioma bibliotekami do scrapowania. |
| Tanie pobranie | `fetch` z nagłówkami zbliżonymi do Chrome, timeout, retry drugim profilem, robots.txt, odrzucenie adresów prywatnych i DNS wskazującego na sieć lokalną. | Nie jest binarką curl-impersonate. Nie ma impersonacji TLS/JA3. |
| Trudna strona | Firecrawl, Browser Use i Crawl4AI tylko dla strony cienkiej albo zablokowanej i tylko gdy jest klucz oraz został budżet. Bogata strona nie generuje drugiego płatnego requestu. | Brak klucza nie jest oznaczany jako sukces Cheerio pod cudzą nazwą. |
| Ograniczone zejście | Własna kolejka: deduplikacja URL, limit hostów, współbieżność, budżet czasu. Deep schodzi w linki wewnętrzne. Szukaj dokłada najwyżej dwie strony, gdy treść ma mniej niż 80 słów. CapEx czyta zaplanowane URL-e i nie chodzi po całej witrynie. | Nie jest Crawlee ani Scrapy. |
| Ekstrakcja | Cheerio: markdown, meta, linki, heurystyka list. Normalizacja już wyciągniętego tekstu. | Nie czyta PDF ani Office. Nie uczy selektorów z przykładu. |
| Weryfikacja | Licznik tokenów zapytania w pobranym tekście i liczba hostów — zawsze. Grok tylko z `XAI_API_KEY`, domyślnie model `grok-4.3` (`XAI_MODEL` może go nadpisać). | Licznik pokrycia nie jest odpowiedzią modelu. |

Każdy etap w wyniku niesie wejście, wyjście, wkład względem poprzedniego kroku, powód pominięcia i pochodzenie implementacji.

## Proponowane później

Nic z tej tabeli nie jest wdrożone. Nie stawiamy tu workera i nie dodajemy sekretów.

| Narzędzie | Rola, gdyby naprawdę działało | Czego brakuje | Koszt / sekret |
| --- | --- | --- | --- |
| curl-impersonate | Etap „tanie pobranie” dla hostów, które odrzucają zwykły TLS Node. | Osobny proces z binarką (nie funkcja Vercel). Wejście: publiczny URL po obecnym filtrze SSRF. Wyjście: surowe bajty odpowiedzi. Limit czasu i rozmiaru taki jak dziś. | Brak klucza API. Wymaga hosta z możliwością uruchomienia binarki i utrzymania jej aktualizacji pod JA3. |
| Scrapling | Etap „trudna strona”, zanim sięgniemy po płatne API: adaptywne selektory i drugi profil pobrania w Pythonie. | Worker Pythona obok aplikacji. Wołany tylko gdy tanie pobranie jest zablokowane. | Brak płatnego API. Wymaga procesu, którego Vercel serverless nie utrzyma. |
| Firecrawl | Już podłączone warunkowo (`FIRECRAWL_API_KEY`, `POST /v1/scrape`). | Zostaje fallbackiem. Nie wolno stawiać go przed tanim pobraniem. | Klucz użytkownika. Bez klucza etap jest pomijany. |
| Browser Use | Już podłączone warunkowo (`BROWSER_USE_API_KEY`, `fetch.browser-use.com`) i tylko dla wciąż cienkiej strony. | To samo ograniczenie: po Firecrawlu, nie równolegle z nim, gdy Firecrawl już oddał treść. | Klucz użytkownika. Limit 2 wywołania na skan. |
| Crawl4AI | Już podłączone, gdy jest `CRAWL4AI_API_KEY` albo `CRAWL4AI_BASE_URL`, i tylko gdy lokalny markdown ma mniej niż 40 słów. | Self-host `/md` to osobny serwis użytkownika, nie część tego deployu. | Klucz chmury albo adres własnej instancji. Bez tego zostaje Cheerio. |
| Crawlee | Etap zejścia, gdy kolejka SPECTRA przestanie wystarczać (sesje, przeglądarka, wielogodzinne joby). | Worker Node z Playwright, kolejka poza funkcją 180 s. Kontrakt: te same reguły SSRF, robots i deduplikacja. | Brak nowego płatnego API. Wymaga hosta workera. Nie wdrażamy go w tym PR. |
| Scrapy | Duży crawl poza interaktywym skanem (katalogi, pełne domeny). | Proces Pythona (Twisted), harmonogram, magazyn URL. Wynik wracałby jako lista adresów do etapu pobrania, nie jako udawany status w UI. | Brak klucza. Osobny host. Poza funkcją Vercel. |
| AutoScraper | Uczenie selektorów z przykładu zaznaczonego przez użytkownika, zamiast stałej heurystyki CSS. | Interpreter Pythona i miejsce na zapisany model selektorów per witryna. | Brak płatnego API. Wymaga workera i świadomej zgody na zapis reguł. |
| MarkItDown | Konwersja PDF i Office do markdown, gdy tanie pobranie widzi taki `Content-Type`. | Python plus biblioteki parsujące dokumenty. Wejście tylko z publicznego URL po SSRF, limit rozmiaru. | Brak klucza Microsoft. Sam pakiet nie działa w funkcji Vercel. |
| scrcpy | Podgląd i sterowanie telefonem Android przez ADB. | Telefon, ADB i proces na maszynie obok urządzenia. Nie produkuje stron WWW. | Brak klucza. **Poza zakresem wyszukiwania.** Nie ma uczciwego „kroku research”, który scrcpy miałby zasilać. Zostaje poza ekranem skanu. |

## Czego ten plan nie robi

- Nie kupuje kredytów i nie dodaje nowego dostawcy.
- Nie uruchamia workera „na wszelki wypadek”.
- Nie oznacza lokalnego Cheerio jako Firecrawl, Crawl4AI, MarkItDown ani AutoScraper.
- Nie woła SerpAPI, Firecrawl, Browser Use i Crawl4AI naraz dla tej samej, już pobranej strony.
