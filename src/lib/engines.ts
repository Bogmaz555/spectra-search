export type EngineId =
  | "firecrawl"
  | "crawl4ai"
  | "browser-use"
  | "crawlee"
  | "scrapy"
  | "markitdown"
  | "scrapling"
  | "scrcpy"
  | "autoscraper"
  | "curl-impersonate";

export type EngineRole =
  | "fetch"
  | "render"
  | "extract"
  | "markdown"
  | "structure"
  | "adapt"
  | "queue"
  | "mobile"
  | "pattern"
  | "scale";

export type EngineCapability =
  | "discovery"
  | "fetch"
  | "render"
  | "extract"
  | "markdown"
  | "structure"
  | "adapt"
  | "queue"
  | "mobile"
  | "pattern"
  | "scale";

/** How this deployment can run the named project. */
export type EngineRuntime = "degraded" | "optional" | "unavailable";

export type EngineSurface = "local" | "optional" | "unavailable";

export interface EngineDef {
  id: EngineId;
  /** What the search UI should call this step. Not a claim that the GitHub project ran. */
  searchLabel: string;
  /**
   * `local` — our own fetch/parse step.
   * `optional` — a real external API, only with a key.
   * `unavailable` — not part of web search in this deployment (hidden from the scan).
   */
  surface: EngineSurface;
  name: string;
  repo: string;
  github: string;
  stars: string;
  license: string;
  role: EngineRole;
  capabilities: EngineCapability[];
  runtime: EngineRuntime;
  /** Honest note shown when the real project is not what just ran. */
  runtimeNote: string;
  /** Env vars that turn an optional/remote adapter on. Empty means none. */
  envKeys?: string[];
  tagline: string;
  description: string;
  pipelineStep: string;
  color: string;
  order: number;
}

/** Katalog nazw z oryginalnego posta — status runtime jest osobno i musi być uczciwy. */
export const ENGINES: EngineDef[] = [
  {
    id: "curl-impersonate",
    searchLabel: "Pobranie HTTP",
    surface: "local",
    name: "curl-impersonate",
    repo: "lwthiker/curl-impersonate",
    github: "https://github.com/lwthiker/curl-impersonate",
    stars: "4k+",
    license: "MIT",
    role: "fetch",
    capabilities: ["fetch"],
    runtime: "degraded",
    runtimeNote:
      "Krok lokalny: nagłówki zbliżone do Chrome przez fetch. Binarka curl-impersonate (TLS/JA3) nie działa na Vercel serverless.",
    tagline: "Pobieranie HTTP — bez udawanego TLS",
    description:
      "Prawdziwy curl-impersonate podszywa się pod Chrome na poziomie TLS. Tutaj zostają nagłówki przeglądarki, timeout, retry i ręczna obsługa przekierowań. To nie jest ta binarka.",
    pipelineStep: "Lokalny fetch z nagłówkami Chrome",
    color: "engine-fetch",
    order: 1,
  },
  {
    id: "scrapling",
    searchLabel: "Detekcja blokady",
    surface: "local",
    name: "Scrapling",
    repo: "D4Vinci/Scrapling",
    github: "https://github.com/D4Vinci/Scrapling",
    stars: "8k+",
    license: "BSD",
    role: "adapt",
    capabilities: ["adapt", "fetch"],
    runtime: "degraded",
    runtimeNote:
      "Krok lokalny: drugi profil nagłówków i detekcja blokad (403/429/CAPTCHA). Biblioteka Scrapling (Python) nie jest uruchomiona.",
    tagline: "Retry i detekcja blokad, nie Scrapling",
    description:
      "Scrapling sam dostosowuje selektory i omija antyboty. W tym wdrożeniu jest tylko lokalny retry oraz rozpoznanie strony blokady. Nie nazywamy tego Scraplingiem.",
    pipelineStep: "Retry po blokadzie (lokalnie)",
    color: "engine-adapt",
    order: 2,
  },
  {
    id: "browser-use",
    searchLabel: "Browser Use",
    surface: "optional",
    name: "Browser Use",
    repo: "browser-use/browser-use",
    github: "https://github.com/browser-use/browser-use",
    stars: "95k+",
    license: "MIT",
    role: "render",
    capabilities: ["render", "fetch"],
    runtime: "optional",
    envKeys: ["BROWSER_USE_API_KEY"],
    runtimeNote:
      "Pominięty — brak BROWSER_USE_API_KEY. Analiza DOM w Cheerio nie jest Browser Use. Z kluczem: fetch.browser-use.com, tylko gdy lokalny fetch jest zablokowany albo pusty.",
    tagline: "Render w chmurze, gdy jest klucz",
    description:
      "Browser Use steruje prawdziwą przeglądarką. Na Vercel nie trzymamy farmy przeglądarek. Opcjonalny klucz woła usługę fetch Browser Use (uproszczony HTML) przy blokadzie. Bez klucza adapter jest pomijany.",
    pipelineStep: "Render chmurowy albo pominięcie",
    color: "engine-render",
    order: 3,
  },
  {
    id: "crawlee",
    searchLabel: "Crawlee",
    surface: "unavailable",
    name: "Crawlee",
    repo: "apify/crawlee",
    github: "https://github.com/apify/crawlee",
    stars: "20k+",
    license: "Apache-2.0",
    role: "queue",
    capabilities: ["queue"],
    runtime: "unavailable",
    runtimeNote:
      "Niedostępny na serverless: biblioteka Crawlee (Apify, worker/Playwright) nie jest uruchamiana. Kolejkę, deduplikację i limit współbieżności robi wbudowany crawler SPECTRA.",
    tagline: "Kolejka SPECTRA, nie Crawlee",
    description:
      "Crawlee to framework z kolejkami i sesjami. Tego procesu tu nie ma. Wielostronicowy crawl idzie własną kolejką ze współbieżnością i deduplikacją URL — status Crawlee zostaje „pominięty”.",
    pipelineStep: "Niedostępny — kolejka jest wbudowana",
    color: "engine-queue",
    order: 4,
  },
  {
    id: "scrapy",
    searchLabel: "Scrapy",
    surface: "unavailable",
    name: "Scrapy",
    repo: "scrapy/scrapy",
    github: "https://github.com/scrapy/scrapy",
    stars: "58k+",
    license: "BSD",
    role: "scale",
    capabilities: ["scale", "extract"],
    runtime: "unavailable",
    runtimeNote:
      "Niedostępny: Scrapy to proces Pythona (Twisted). Nie działa w funkcji Vercel. Ekstrakcja HTML idzie parserem Cheerio i nie jest Scrapy.",
    tagline: "Silnik Pythona — poza tym wdrożeniem",
    description:
      "Scrapy crawluje w skali z własnym schedulerem. Nie da się go uczciwie uruchomić w serverless bez osobnego workera. Adapter nie zgłasza sukcesu.",
    pipelineStep: "Niedostępny na Vercel",
    color: "engine-scale",
    order: 5,
  },
  {
    id: "autoscraper",
    searchLabel: "Heurystyka list",
    surface: "local",
    name: "AutoScraper",
    repo: "alirezamika/autoscraper",
    github: "https://github.com/alirezamika/autoscraper",
    stars: "7k+",
    license: "MIT",
    role: "pattern",
    capabilities: ["pattern", "extract"],
    runtime: "degraded",
    runtimeNote:
      "Krok lokalny: heurystyka list, kart i tabel (CSS). AutoScraper (Python, uczenie z przykładu) nie jest uruchomiony.",
    tagline: "Wzorce z heurystyki, nie z AutoScraper",
    description:
      "AutoScraper uczy się reguł z przykładu. Tutaj powtarzalne listy i karty wykrywa stały zestaw selektorów. To lokalna heurystyka, oznaczona jako aproksymacja.",
    pipelineStep: "Heurystyka list i kart",
    color: "engine-pattern",
    order: 6,
  },
  {
    id: "firecrawl",
    searchLabel: "Firecrawl",
    surface: "optional",
    name: "Firecrawl",
    repo: "firecrawl/firecrawl",
    github: "https://github.com/firecrawl/firecrawl",
    stars: "130k+",
    license: "AGPL-3.0",
    role: "structure",
    capabilities: ["structure", "fetch", "markdown"],
    runtime: "optional",
    envKeys: ["FIRECRAWL_API_KEY"],
    runtimeNote:
      "Pominięty — brak FIRECRAWL_API_KEY. Lokalne pola meta nie są Firecrawlem. Z kluczem: POST https://api.firecrawl.dev/v1/scrape.",
    tagline: "Prawdziwe API, gdy jest klucz",
    description:
      "Firecrawl zwraca markdown, HTML i linki z renderem JS. SPECTRA woła oficjalne API v1 tylko przy FIRECRAWL_API_KEY. Bez klucza adapter jest pomijany — nie stemplujemy Cheerio jako Firecrawl.",
    pipelineStep: "API scrape albo pominięcie",
    color: "engine-structure",
    order: 7,
  },
  {
    id: "crawl4ai",
    searchLabel: "Markdown",
    surface: "local",
    name: "Crawl4AI",
    repo: "unclecode/crawl4ai",
    github: "https://github.com/unclecode/crawl4ai",
    stars: "51k+",
    license: "Apache-2.0",
    role: "markdown",
    capabilities: ["markdown"],
    runtime: "degraded",
    envKeys: ["CRAWL4AI_API_KEY", "CRAWL4AI_BASE_URL"],
    runtimeNote:
      "Krok lokalny: HTML→Markdown (Cheerio). Crawl4AI (Python + przeglądarka) nie działa na Vercel. Ustaw CRAWL4AI_API_KEY (chmura) albo CRAWL4AI_BASE_URL (własne /md), żeby wołać prawdziwe API.",
    tagline: "Markdown lokalnie albo z własnego API",
    description:
      "Crawl4AI zamienia strony w markdown przez przeglądarkę. Bez klucza lub adresu instancji SPECTRA używa własnego konwertera i oznacza to jako aproksymację. Z CRAWL4AI_API_KEY woła api.crawl4ai.com, z CRAWL4AI_BASE_URL — self-host POST /md.",
    pipelineStep: "Markdown: API albo konwerter lokalny",
    color: "engine-markdown",
    order: 8,
  },
  {
    id: "markitdown",
    searchLabel: "Normalizacja tekstu",
    surface: "local",
    name: "MarkItDown",
    repo: "microsoft/markitdown",
    github: "https://github.com/microsoft/markitdown",
    stars: "70k+",
    license: "MIT",
    role: "markdown",
    capabilities: ["markdown"],
    runtime: "degraded",
    runtimeNote:
      "Krok lokalny: normalizacja już wyciągniętego Markdown. MarkItDown (Python, PDF i Office) nie jest uruchomiony — pliki binarne nie są konwertowane.",
    tagline: "Czyszczenie Markdown, nie konwersja Office",
    description:
      "MarkItDown Microsoftu czyta PDF, Office i HTML. Tutaj jest tylko porządkowanie tekstu Markdown. PDF i dokumenty Office bez osobnego API zostają nietknięte.",
    pipelineStep: "Normalizacja tekstu",
    color: "engine-doc",
    order: 9,
  },
  {
    id: "scrcpy",
    searchLabel: "scrcpy",
    surface: "unavailable",
    name: "scrcpy",
    repo: "Genymobile/scrcpy",
    github: "https://github.com/Genymobile/scrcpy",
    stars: "130k+",
    license: "Apache-2.0",
    role: "mobile",
    capabilities: ["mobile"],
    runtime: "unavailable",
    runtimeNote:
      "Niedostępny: scrcpy wymaga ADB i urządzenia Android. To wdrożenie nie steruje telefonem. Metadane viewportu na stronie nie są wynikiem scrcpy.",
    tagline: "Android poza tym wdrożeniem",
    description:
      "scrcpy wyświetla i steruje telefonem przez ADB. W funkcji serverless nie ma urządzenia. Adapter zawsze jest pomijany — nawet jeśli strona ma viewport mobile.",
    pipelineStep: "Niedostępny — brak ADB",
    color: "engine-mobile",
    order: 10,
  },
];

export const ENGINE_MAP = Object.fromEntries(ENGINES.map((e) => [e.id, e])) as Record<
  EngineId,
  EngineDef
>;

/** Steps that can actually run. Scrapy, Crawlee and scrcpy stay out of the scan. */
export const DEFAULT_ENGINE_IDS: EngineId[] = ENGINES.filter((e) => e.surface !== "unavailable").map(
  (e) => e.id,
);
