import type { DiscoveryRun, ResearchStage, SpectraAi } from "./types.ts";

export const CASCADE_STEPS: { id: ResearchStage["id"]; label: string; role: string }[] = [
  {
    id: "discovery",
    label: "Odkrywanie",
    role: "Skąd biorą się adresy: SerpAPI (gdy jest klucz), darmowe API i — osobno — KRS, ścieżki firmy oraz newsy w trybie CapEx.",
  },
  {
    id: "fetch",
    label: "Tanie pobranie",
    role: "Zwykły HTTP z nagłówkami przeglądarki, limitem czasu i odrzuceniem adresów prywatnych. To nie jest curl-impersonate.",
  },
  {
    id: "fallback",
    label: "Trudna strona",
    role: "Firecrawl, Browser Use albo Crawl4AI tylko gdy tanie pobranie jest puste lub zablokowane i jest klucz. Bogata strona nie generuje płatnego wywołania.",
  },
  {
    id: "deep",
    label: "Ograniczone zejście",
    role: "Własna kolejka SPECTRA. Deep schodzi w linki wewnętrzne. Szukaj dokłada najwyżej dwie strony, gdy pierwsza treść jest za cienka. To nie jest Crawlee ani Scrapy.",
  },
  {
    id: "extract",
    label: "Ekstrakcja",
    role: "Cheerio: markdown, pola meta, listy. Normalizacja tekstu nie czyta PDF ani Office — to nie jest MarkItDown ani AutoScraper.",
  },
  {
    id: "verify",
    label: "Weryfikacja",
    role: "Pokrycie tokenów zapytania i różnorodność hostów zawsze. Grok (grok-4.3, o ile nie nadpisano XAI_MODEL) tylko gdy jest klucz i synteza jest włączona.",
  },
];

const STOP = new Set([
  "oraz",
  "albo",
  "dla",
  "przy",
  "przez",
  "jest",
  "nie",
  "się",
  "sie",
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "http",
  "https",
  "www",
]);

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** How much of the query shows up in fetched text. Digits (KRS, NIP) count. */
export function queryCoverage(
  query: string,
  corpus: string,
): { covered: string[]; missing: string[]; ratio: number } {
  const fold = (value: string) => value.toLocaleLowerCase("pl");
  const tokens = [
    ...new Set((query.match(/[\p{L}\p{N}]{3,}/gu) ?? []).map(fold)),
  ].filter((token) => !STOP.has(token));
  if (!tokens.length) return { covered: [], missing: [], ratio: 1 };
  const hay = fold(corpus);
  const covered = tokens.filter((token) => hay.includes(token));
  const missing = tokens.filter((token) => !hay.includes(token));
  return { covered, missing, ratio: covered.length / tokens.length };
}

export interface CascadeFacts {
  mode: "search" | "url" | "deep" | "capex";
  query: string;
  discovery: DiscoveryRun[];
  hits: number;
  pages: number;
  cheapOk: number;
  cheapFail: number;
  cheapSkipped: number;
  thinPages: number;
  firecrawlCalls: number;
  firecrawlOk: number;
  browserCalls: number;
  browserOk: number;
  crawl4aiCalls: number;
  crawl4aiOk: number;
  followed: number;
  words: number;
  fields: number;
  patterns: number;
  hosts: number;
  httpOk: number;
  coverage: number;
  covered: string[];
  missing: string[];
  useAi: boolean;
  ai: Pick<SpectraAi, "used" | "model" | "error" | "citations">;
}

function stage(
  id: ResearchStage["id"],
  status: ResearchStage["status"],
  input: string,
  output: string,
  contribution: string,
  provenance: string,
  reason?: string,
): ResearchStage {
  const label = CASCADE_STEPS.find((step) => step.id === id)?.label ?? id;
  return { id, label, status, input, output, contribution, provenance, reason };
}

export function buildResearchStages(facts: CascadeFacts): ResearchStage[] {
  const providers = facts.discovery.filter((run) => run.id !== "serpapi-budget");
  const useful = providers.filter((run) => run.status === "live" && run.hits > 0);
  const failed = providers.filter((run) => run.status === "error");
  const notApplicable = providers.length > 0 && providers.every((run) => run.status === "not_applicable");
  const discovery = notApplicable
    ? stage(
        "discovery",
        "not_applicable",
        facts.query,
        "Źródła zapytań nie były wołane.",
        "Żaden adres nie pochodzi z wyszukiwarki — startem jest podany URL.",
        "Brak wywołań SerpAPI, Wikipedii, DuckDuckGo i KRS.",
        providers[0]?.message,
      )
    : useful.length
      ? stage(
          "discovery",
          "live",
          facts.query,
          `${facts.hits} adresów. Źródła z trafieniami: ${useful.map((run) => `${run.label} (${run.hits})`).join(", ")}.`,
          failed.length
            ? `Dokładają adresy mimo błędu: ${failed.map((run) => run.label).join(", ")}.`
            : `Nowe adresy względem pustego startu: ${facts.hits}.`,
          "API i RSS wymienionych źródeł. Pusty wynik nie jest liczony jako wkład.",
        )
      : failed.length
        ? stage(
            "discovery",
            "error",
            facts.query,
            failed.map((run) => `${run.label}: ${run.message}`).slice(0, 4).join(" "),
            "Zero nowych adresów.",
            "Wywołano źródła, które odpowiedziały błędem.",
            "Żadne źródło nie zwróciło adresu.",
          )
        : stage(
            "discovery",
            facts.hits > 0 ? "live" : "skipped",
            facts.query,
            facts.hits ? `${facts.hits} adresów spoza listy źródeł.` : "Brak adresów.",
            facts.hits ? `${facts.hits} adresów.` : "Nic nie dodano.",
            "Źródła odpowiedziały albo zapytanie nie miało czego szukać.",
            facts.hits ? undefined : "Odpowiedzi były puste albo źródeł nie było.",
          );

  const attempted = facts.cheapOk + facts.cheapFail + facts.cheapSkipped;
  const fetch = attempted
    ? stage(
        "fetch",
        facts.cheapOk > 0 ? "local" : facts.cheapFail > 0 ? "error" : "skipped",
        `${attempted} adresów publicznych po filtrze SSRF`,
        `OK ${facts.cheapOk} · błąd lub blokada ${facts.cheapFail} · pominięte ${facts.cheapSkipped} · cienkie ${facts.thinPages}`,
        facts.cheapOk
          ? `${facts.cheapOk === 1 ? "1 strona" : `${facts.cheapOk} stron`} z treścią albo odpowiedzią HTTP, bez płatnego API.`
          : "Tanie pobranie nie dało użytecznej strony.",
        "fetch + nagłówki Chrome, timeout, robots.txt. Bez binarki curl-impersonate (brak TLS/JA3).",
        facts.cheapOk > 0
          ? undefined
          : facts.cheapFail > 0
            ? "Odpowiedź była błędem, blokadą albo pustką."
            : "robots.txt albo brak próby.",
      )
    : stage(
        "fetch",
        "skipped",
        "0 adresów",
        "Nie pobierano.",
        "Brak wkładu.",
        "fetch nie został wywołany.",
        "Discovery nie dało publicznego URL albo budżet czasu się skończył.",
      );

  const paidCalls = facts.firecrawlCalls + facts.browserCalls + facts.crawl4aiCalls;
  const paidOk = facts.firecrawlOk + facts.browserOk + facts.crawl4aiOk;
  const fallback =
    paidOk > 0
      ? stage(
          "fallback",
          "live",
          `${facts.thinPages} cienkich lub zablokowanych stron`,
          `Firecrawl ${facts.firecrawlOk}/${facts.firecrawlCalls}, Browser Use ${facts.browserOk}/${facts.browserCalls}, Crawl4AI ${facts.crawl4aiOk}/${facts.crawl4aiCalls}.`,
          "Treść pochodzi z prawdziwego API, bo tanie pobranie nie wystarczyło.",
          "Tylko skonfigurowane klucze. Bogate strony nie były wysyłane.",
        )
      : paidCalls > 0
        ? stage(
            "fallback",
            "error",
            `${facts.thinPages} stron wymagało pomocy`,
            `Wywołania bez treści: Firecrawl ${facts.firecrawlCalls}, Browser Use ${facts.browserCalls}, Crawl4AI ${facts.crawl4aiCalls}.`,
            "Zostaje to, co oddało tanie pobranie.",
            "API fallbacku odpowiedziało błędem. Lokalny HTML nie jest przedstawiany jako to API.",
            "Płatny albo zdalny fallback nie zwrócił treści.",
          )
        : facts.thinPages > 0
          ? stage(
              "fallback",
              "skipped",
              `${facts.thinPages} cienkich lub zablokowanych stron`,
              "Żadnego wywołania Firecrawl, Browser Use ani Crawl4AI.",
              "Brak dodatkowej treści.",
              "Brak klucza albo koniec budżetu czasu lub limitu wywołań.",
              "Nie wołam płatnej usługi bez klucza i nie wołam jej dla stron, które już mają treść.",
            )
          : stage(
              "fallback",
              attempted ? "skipped" : "not_applicable",
              attempted ? "Strony z taniego pobrania" : "Brak stron",
              "Fallback nie był potrzebny.",
              "Zero dodatkowych wywołań.",
              "Warunek: pusta albo zablokowana strona oraz klucz.",
              attempted
                ? "Tanie pobranie wystarczyło — pominięto płatne API, żeby nie dublować kosztu."
                : "Nie było strony, której fallback mógłby dotknąć.",
            );

  const deep =
    facts.mode === "url"
      ? stage(
          "deep",
          "not_applicable",
          facts.query,
          "Jeden adres.",
          "Brak dodatkowych stron.",
          "Tryb URL nie schodzi w linki. Kolejka SPECTRA, nie Crawlee.",
          "Celowo jeden dokument.",
        )
      : facts.followed > 0
        ? stage(
            "deep",
            "local",
            `${facts.pages} stron w budżecie`,
            `Dorzuczono ${facts.followed} adresów z linków wewnętrznych (limit ${2} w trybie szukania, więcej tylko w Deep).`,
            `${facts.followed} nowych adresów tego samego badania, po deduplikacji.`,
            "Własna kolejka: deduplikacja, limit hostów, SSRF, timeout. To nie jest Crawlee ani Scrapy.",
          )
        : facts.mode === "capex"
          ? stage(
              "deep",
              facts.pages > 0 ? "local" : "skipped",
              "URL użytkownika, ścieżki firmy i newsy",
              facts.pages ? `Pobrano ${facts.pages} zaplanowanych stron.` : "Nic nie pobrano.",
              facts.pages
                ? "CapEx czyta zaplanowaną kolejkę, nie całą witrynę."
                : "Kolejka była pusta.",
              "Bez schodzenia w linki wewnętrzne. Nie Crawlee.",
              facts.pages ? undefined : "Brak adresów w budżecie.",
            )
          : facts.mode === "deep"
            ? stage(
                "deep",
                "skipped",
                "Linki wewnętrzne pobranych stron",
                "Nie dorzucono kolejnych adresów.",
                "Brak zejścia.",
                "Kolejka SPECTRA.",
                "Brak linków wewnętrznych, koniec limitu stron albo czasu.",
              )
            : stage(
                "deep",
                "skipped",
                "Pierwsze strony wyniku",
                facts.words >= 80
                  ? `${facts.words} słów — zejście pominięte.`
                  : "Treść cienka, ale nie było bezpiecznego linku do dorzucenia.",
                "Zero dodatkowych stron.",
                "Ratunkowe zejście tylko przy cienkiej treści, najwyżej dwie strony, ten sam filtr SSRF.",
                facts.words >= 80
                  ? "Pierwsze pobranie już niesie treść."
                  : "Brak wewnętrznego linku albo koniec czasu.",
              );

  const extract =
    facts.pages === 0
      ? stage(
          "extract",
          "not_applicable",
          "Brak HTML",
          "Nie wyciągano pól.",
          "Brak wkładu.",
          "Cheerio nie dostał dokumentu.",
          "Nie było strony.",
        )
      : stage(
          "extract",
          facts.words > 0 || facts.fields > 0 ? "local" : "skipped",
          `${facts.pages} pobranych dokumentów`,
          `${facts.words} słów · ${facts.fields} pól · ${facts.patterns} grup wzorców.`,
          facts.words > 0 ? "Tekst i pola, których nie było w samym adresie URL." : "Dokument bez tekstu.",
          facts.crawl4aiOk
            ? `Markdown z API Crawl4AI na ${facts.crawl4aiOk} stronach; reszta to Cheerio. PDF/Office nie są konwertowane.`
            : "Cheerio i lokalna normalizacja Markdown. Nie MarkItDown (brak PDF/Office) i nie AutoScraper (brak uczenia z przykładu).",
          facts.words > 0 ? undefined : "Parser nie znalazł tekstu.",
        );

  const coveragePct = Math.round(facts.coverage * 100);
  const verify =
    facts.pages === 0 && facts.hits === 0
      ? stage(
          "verify",
          "skipped",
          facts.query,
          "Brak materiału.",
          "Nie ma czego sprawdzać.",
          "Lokalne pokrycie tokenów; Grok tylko z XAI_API_KEY.",
          "Discovery i pobranie nic nie przyniosły.",
        )
      : facts.ai.used
        ? stage(
            "verify",
            "live",
            `${facts.pages} stron · pokrycie ${coveragePct}% · ${facts.hosts} hostów`,
            `Grok ${facts.ai.model}: ${facts.ai.citations.length} cytowań. Tokeny: ${facts.covered.join(", ") || "—"}.`,
            "Odpowiedź modelu na zebranym materiale plus licznik pokrycia, który nie zależy od modelu.",
            `xAI ${facts.ai.model}. Pokrycie tokenów liczy SPECTRA, nie model.`,
          )
        : stage(
            "verify",
            "local",
            facts.query,
            `Pokrycie ${coveragePct}% (${facts.covered.length} z ${facts.covered.length + facts.missing.length}). Brakuje: ${facts.missing.slice(0, 8).join(", ") || "—"}. HTTP OK ${facts.httpOk}/${facts.pages}.`,
            "Wiadomo, które słowa zapytania mają oparcie w tekście, zanim ktokolwiek włączy model.",
            facts.useAi
              ? `Grok nie oddał odpowiedzi${facts.ai.error ? ` (${facts.ai.error})` : ""}. Zostaje licznik pokrycia.`
              : "Synteza Grok wyłączona albo brak XAI_API_KEY. Domyślny model, gdy klucz jest: grok-4.3.",
            facts.useAi && facts.ai.error ? facts.ai.error : "Model nie był potrzebny do tej metryki.",
          );

  return [discovery, fetch, fallback, deep, extract, verify];
}
