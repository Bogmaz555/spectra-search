/**
 * What the product actually searches with.
 * Kept separate from the historical GitHub names in `engines.ts`.
 */

export type CatalogTier = "free" | "optional";

export interface QuerySource {
  id: string;
  label: string;
  tier: CatalogTier;
  /** Env var for optional sources. Never a secret value. */
  envKey?: string;
  detail: string;
}

/** Ids match `DISCOVERY_PROVIDER_IDS`. */
export const QUERY_SOURCES: QuerySource[] = [
  {
    id: "serpapi",
    label: "SerpAPI Google",
    tier: "optional",
    envKey: "SERPAPI_API_KEY",
    detail:
      "Prawdziwe wyniki Google, gdy klucz jest ustawiony. Darmowy plan jest mały (około 250 zapytań miesięcznie), więc jeden skan zużywa co najwyżej kilka wywołań. Bez klucza źródło jest pomijane.",
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo HTML",
    tier: "free",
    detail:
      "Scraping strony wyników, nie oficjalne API. Z Vercel często wraca 403 albo strona blokady. To błąd tego źródła — Wikipedia i reszta darmowych API lecą dalej.",
  },
  {
    id: "duckduckgo-lite",
    label: "DuckDuckGo Lite",
    tier: "free",
    detail: "Drugi, lżejszy HTML DuckDuckGo. Ta sama klasa blokad co wersja HTML. Nie jest osobną integracją.",
  },
  {
    id: "wikipedia-pl",
    label: "Wikipedia PL",
    tier: "free",
    detail: "Oficjalne API MediaWiki. Działa bez klucza.",
  },
  {
    id: "wikipedia-en",
    label: "Wikipedia EN",
    tier: "free",
    detail: "Oficjalne API MediaWiki. Działa bez klucza.",
  },
  {
    id: "wikipedia-de",
    label: "Wikipedia DE",
    tier: "free",
    detail: "Oficjalne API MediaWiki. Działa bez klucza.",
  },
  {
    id: "wikidata",
    label: "Wikidata",
    tier: "free",
    detail: "API wbsearchentities. Działa bez klucza.",
  },
  {
    id: "hackernews",
    label: "Hacker News",
    tier: "free",
    detail: "API Algolii (hn.algolia.com). Działa bez klucza.",
  },
  {
    id: "stackoverflow",
    label: "Stack Overflow",
    tier: "free",
    detail: "API Stack Exchange. Działa bez klucza; anonimowy limit bywa niski.",
  },
  {
    id: "arxiv",
    label: "arXiv",
    tier: "free",
    detail: "Publiczny eksport Atom. Działa bez klucza.",
  },
  {
    id: "github",
    label: "GitHub",
    tier: "free",
    detail: "API wyszukiwania repozytoriów. Działa bez klucza; anonimowy limit bywa niski.",
  },
  {
    id: "brave",
    label: "Brave Search",
    tier: "optional",
    envKey: "BRAVE_SEARCH_API_KEY",
    detail: "Prawdziwe API Brave. Bez klucza pomijane — nie udajemy wyników.",
  },
  {
    id: "serper",
    label: "Serper",
    tier: "optional",
    envKey: "SERPER_API_KEY",
    detail: "Płatne API Google przez Serper. Bez klucza pomijane.",
  },
];

export const CAPEX_SOURCES: QuerySource[] = [
  {
    id: "krs",
    label: "KRS",
    tier: "free",
    detail:
      "Odpis aktualny z api-krs.ms.gov.pl (zarząd i prokurenci). NIP spółki jest zamieniany na KRS przez publiczny wykaz VAT. CEIDG nie jest podłączone. Brak numeru to „nie dotyczy”, awaria API to błąd.",
  },
  {
    id: "company-paths",
    label: "Ścieżki firmy",
    tier: "free",
    detail:
      "GET /aktualnosci, /inwestycje, /o-nas, /kontakt na domenie firmy. Do kolejki wchodzi tylko HTTP 200 na tym samym hoście.",
  },
  {
    id: "google-news",
    label: "Google News",
    tier: "free",
    detail:
      "RSS bez klucza (szablony inwestycyjne). Gdy jest SerpAPI, kilka pierwszych zapytań idzie przez google_news, a RSS zostaje zapasem. Pusta odpowiedź nie jest błędem.",
  },
  {
    id: "capex-press",
    label: "Prasa branżowa",
    tier: "free",
    detail:
      "Te same mechanizmy, zapytania site: WNP, Puls Biznesu, Automatyka B2B, Opakowanie, Magazyn Przemysłowy.",
  },
];

export const OUTSIDE_SEARCH = [
  {
    id: "scrapy",
    label: "Scrapy",
    detail: "Proces Pythona. Nie działa w funkcji Vercel i nie jest źródłem wyników.",
  },
  {
    id: "crawlee",
    label: "Crawlee",
    detail:
      "Worker Apify / Playwright. Kolejka, deduplikacja i limit współbieżności są wbudowane w SPECTRA — to nie jest Crawlee.",
  },
  {
    id: "scrcpy",
    label: "scrcpy",
    detail:
      "Podgląd telefonu przez ADB. Nie ma związku z wyszukiwaniem stron i nie pojawia się w skanie.",
  },
] as const;
