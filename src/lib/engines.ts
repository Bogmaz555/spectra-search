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

export interface EngineDef {
  id: EngineId;
  name: string;
  repo: string;
  github: string;
  stars: string;
  license: string;
  role: EngineRole;
  tagline: string;
  description: string;
  pipelineStep: string;
  color: string;
  order: number;
}

/** Ten silników z posta — złączone w jeden pipeline SPECTRA */
export const ENGINES: EngineDef[] = [
  {
    id: "curl-impersonate",
    name: "curl-impersonate",
    repo: "lwthiker/curl-impersonate",
    github: "https://github.com/lwthiker/curl-impersonate",
    stars: "4k+",
    license: "MIT",
    role: "fetch",
    tagline: "HTTP jak z prawdziwej przeglądarki",
    description:
      "Ulepszony curl, który idealnie maskuje się pod Chrome. Nagłówki, kolejność i fingerprint wyglądają jak u żywego użytkownika.",
    pipelineStep: "Pobieranie z fingerprintem przeglądarki",
    color: "engine-fetch",
    order: 1,
  },
  {
    id: "scrapling",
    name: "Scrapling",
    repo: "D4Vinci/Scrapling",
    github: "https://github.com/D4Vinci/Scrapling",
    stars: "8k+",
    license: "BSD",
    role: "adapt",
    tagline: "Niewidzialny crawler odporny na antyboty",
    description:
      "Automatycznie dostosowuje się do zmian strony i omija detekcję. Retry, rotacja i adaptacyjne selektory.",
    pipelineStep: "Adaptacja i omijanie antybotów",
    color: "engine-adapt",
    order: 2,
  },
  {
    id: "browser-use",
    name: "Browser Use",
    repo: "browser-use/browser-use",
    github: "https://github.com/browser-use/browser-use",
    stars: "95k+",
    license: "MIT",
    role: "render",
    tagline: "AI-agent steruje przeglądarką jak człowiek",
    description:
      "Kliknięcia, scroll, logowanie, formularze — radzi sobie ze stronami, których zwykły scraper nie ogarnie.",
    pipelineStep: "Analiza interaktywnych elementów DOM",
    color: "engine-render",
    order: 3,
  },
  {
    id: "crawlee",
    name: "Crawlee",
    repo: "apify/crawlee",
    github: "https://github.com/apify/crawlee",
    stars: "20k+",
    license: "Apache-2.0",
    role: "queue",
    tagline: "Profesjonalny framework crawlera",
    description:
      "Kolejki, retry, proxy-ready, zarządzanie sesją. To, na czym firmy crawlerskie budują produkty za tysiące.",
    pipelineStep: "Kolejkowanie linków i multi-page crawl",
    color: "engine-queue",
    order: 4,
  },
  {
    id: "scrapy",
    name: "Scrapy",
    repo: "scrapy/scrapy",
    github: "https://github.com/scrapy/scrapy",
    stars: "58k+",
    license: "BSD",
    role: "scale",
    tagline: "Przemysłowy crawler od 15+ lat",
    description:
      "Miliony stron, czysty eksport danych, sprawdzony w skali, której większość płatnych narzędzi nie ogarnia.",
    pipelineStep: "Skalowalne wyciąganie elementów",
    color: "engine-scale",
    order: 5,
  },
  {
    id: "autoscraper",
    name: "AutoScraper",
    repo: "alirezamika/autoscraper",
    github: "https://github.com/alirezamika/autoscraper",
    stars: "7k+",
    license: "MIT",
    role: "pattern",
    tagline: "Ucz się wzorców z jednego przykładu",
    description:
      "Podajesz przykład — silnik sam wykrywa reguły i zdejmuje dane z całej strony. Zero selektorów do utrzymania.",
    pipelineStep: "Wykrywanie wzorców list i kart",
    color: "engine-pattern",
    order: 6,
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    repo: "firecrawl/firecrawl",
    github: "https://github.com/firecrawl/firecrawl",
    stars: "130k+",
    license: "AGPL-3.0",
    role: "structure",
    tagline: "Strukturalne dane gotowe dla AI",
    description:
      "Wskazujesz URL — dostajesz render JS + structured output, który modele językowe czytają od razu.",
    pipelineStep: "Strukturyzacja JSON dla AI",
    color: "engine-structure",
    order: 7,
  },
  {
    id: "crawl4ai",
    name: "Crawl4AI",
    repo: "unclecode/crawl4ai",
    github: "https://github.com/unclecode/crawl4ai",
    stars: "51k+",
    license: "Apache-2.0",
    role: "markdown",
    tagline: "Każda strona → czysty Markdown",
    description:
      "Najpopularniejszy crawler AI-first. Bez kluczy API, bez opłat za stronę — markdown w milisekundach.",
    pipelineStep: "Konwersja treści do Markdown",
    color: "engine-markdown",
    order: 8,
  },
  {
    id: "markitdown",
    name: "MarkItDown",
    repo: "microsoft/markitdown",
    github: "https://github.com/microsoft/markitdown",
    stars: "70k+",
    license: "MIT",
    role: "markdown",
    tagline: "PDF, Office, web → Markdown",
    description:
      "Narzędzie Microsoftu: pliki, PDF-y, dokumenty Office i strony — jeden pipeline do formatu AI-ready.",
    pipelineStep: "Czyszczenie i normalizacja dokumentu",
    color: "engine-doc",
    order: 9,
  },
  {
    id: "scrcpy",
    name: "scrcpy",
    repo: "Genymobile/scrcpy",
    github: "https://github.com/Genymobile/scrcpy",
    stars: "130k+",
    license: "Apache-2.0",
    role: "mobile",
    tagline: "Dane z Androida poza webem",
    description:
      "Zdalne sterowanie telefonem Android. Gdy brak webowej wersji aplikacji — wciąż da się wyciągnąć dane.",
    pipelineStep: "Analiza warstwy mobile / viewport",
    color: "engine-mobile",
    order: 10,
  },
];

export const ENGINE_MAP = Object.fromEntries(
  ENGINES.map((e) => [e.id, e]),
) as Record<EngineId, EngineDef>;

export const DEFAULT_ENGINE_IDS: EngineId[] = ENGINES.map((e) => e.id);
