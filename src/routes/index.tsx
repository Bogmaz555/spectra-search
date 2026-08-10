import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  Clock,
  Crosshair,
  Globe2,
  History,
  Loader2,
  Radar,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_ENGINE_IDS, type EngineId } from "@/lib/engines";
import { spectraAiStatus, spectraSearch } from "@/lib/search";
import type { SearchMode, SpectraResult } from "@/lib/scrape/types";
import { cn, formatDuration } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { EngineChip, EnginePipeline } from "@/components/engine-pipeline";
import { ResultsPanel } from "@/components/results-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({ component: HomePage });

const EXAMPLES = [
  { label: "Wikipedia: AI", query: "sztuczna inteligencja", mode: "search" as const },
  { label: "Crawl URL", query: "https://example.com", mode: "url" as const },
  { label: "Deep: React", query: "React Server Components", mode: "deep" as const },
  { label: "GitHub trending", query: "https://github.com/trending", mode: "url" as const },
  { label: "OpenAI docs", query: "https://platform.openai.com/docs", mode: "url" as const },
  { label: "Wyszukaj: crawler", query: "open source web crawler AI", mode: "search" as const },
];

const HISTORY_KEY = "spectra-history-v1";
const MAX_HISTORY = 12;

type HistoryItem = { query: string; mode: SearchMode; at: string };

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryItem[];
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  } catch {
    /* */
  }
}

function HomePage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("auto");
  const [engines, setEngines] = useState<EngineId[]>(DEFAULT_ENGINE_IDS);
  const [useAi, setUseAi] = useState(true);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpectraResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showEngines, setShowEngines] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
    void spectraAiStatus()
      .then((s) => setAiAvailable(s.available))
      .catch(() => setAiAvailable(false));
  }, []);

  const toggleEngine = useCallback((id: EngineId) => {
    setEngines((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((e) => e !== id);
      }
      return [...prev, id];
    });
  }, []);

  const runSearch = useCallback(
    async (q: string, m: SearchMode = mode) => {
      const trimmed = q.trim();
      if (!trimmed) {
        toast.error("Wpisz zapytanie lub URL");
        return;
      }
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const data = await spectraSearch({
          data: {
            query: trimmed,
            mode: m,
            engines,
            maxPages: m === "deep" ? 3 : 2,
            useAi,
          },
        });
        setResult(data);
        const next: HistoryItem[] = [
          { query: trimmed, mode: m, at: new Date().toISOString() },
          ...history.filter((h) => h.query !== trimmed),
        ].slice(0, MAX_HISTORY);
        setHistory(next);
        saveHistory(next);
        if (data.ai.used) toast.success("Grok zsyntezował odpowiedź");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Wyszukiwanie nie powiodło się";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [engines, history, mode, useAi],
  );

  const modes = useMemo(
    () =>
      [
        { id: "auto" as const, label: "Auto", icon: Sparkles, hint: "URL lub zapytanie" },
        { id: "search" as const, label: "Szukaj", icon: Search, hint: "Discovery + scrape" },
        { id: "url" as const, label: "URL", icon: Globe2, hint: "Bezpośredni crawl" },
        { id: "deep" as const, label: "Deep", icon: Crosshair, hint: "Multi-page" },
      ] as const,
    [],
  );

  return (
    <AppShell>
      <section
        className={cn("mx-auto max-w-3xl text-center", result ? "mb-8" : "mb-10 pt-4 sm:pt-10")}
      >
        {!result && (
          <>
            <div className="mb-5 inline-flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs text-fg-muted">
                <Radar className="h-3.5 w-3.5 text-signal" />
                10 silników · kompletny pipeline
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                  aiAvailable
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-border bg-surface/80 text-fg-muted",
                )}
              >
                <Sparkles className="h-3 w-3" />
                {aiAvailable === null
                  ? "Sprawdzam Grok…"
                  : aiAvailable
                    ? "Grok gotowy"
                    : "Grok: dodaj XAI_API_KEY"}
              </span>
            </div>
            <h1 className="font-display text-[clamp(1.85rem,5vw,3rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-fg">
              Najlepszy sposób
              <br />
              <span className="text-fg-muted">kompleksowego przeszukiwania</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-fg-muted sm:text-base">
              Wpisz pytanie albo wklej URL. SPECTRA zbiera źródła 10 silnikami crawlingu, a
              opcjonalnie Grok (xAI) spina je w jedną odpowiedź.
            </p>
          </>
        )}

        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query);
          }}
        >
          <div className="relative rounded-[var(--radius-2xl)] border border-border-strong bg-surface p-2 shadow-soft sm:p-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Zapytanie lub URL strony…"
                  className="h-12 border-0 bg-transparent pl-10 pr-10 shadow-none focus-visible:ring-0"
                  autoFocus
                  disabled={loading}
                  aria-label="Zapytanie wyszukiwania"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg"
                    aria-label="Wyczyść"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button type="submit" size="lg" disabled={loading} className="h-12 shrink-0 px-6">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Skanuję…
                  </>
                ) : (
                  <>
                    <Radar className="h-4 w-4" />
                    Skanuj
                  </>
                )}
              </Button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border px-1 pt-2">
              {modes.map((m) => {
                const Icon = m.icon;
                const active = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    title={m.hint}
                    onClick={() => setMode(m.id)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                      active
                        ? "bg-accent text-accent-fg"
                        : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {m.label}
                  </button>
                );
              })}

              <button
                type="button"
                title={
                  aiAvailable
                    ? "Synteza odpowiedzi przez Grok po scrape"
                    : "Wymaga XAI_API_KEY na Vercel"
                }
                onClick={() => setUseAi((v) => !v)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                  useAi
                    ? "bg-signal/15 text-signal"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Sparkles className="h-3 w-3" />
                Grok {useAi ? "ON" : "OFF"}
              </button>

              <button
                type="button"
                onClick={() => setShowEngines((v) => !v)}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                Silniki
                <Badge variant="default" className="px-1.5 py-0">
                  {engines.length}/10
                </Badge>
              </button>
            </div>

            {showEngines && (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border px-1 pb-1 pt-3">
                {DEFAULT_ENGINE_IDS.map((id) => (
                  <EngineChip
                    key={id}
                    id={id}
                    active={engines.includes(id)}
                    onToggle={() => toggleEngine(id)}
                  />
                ))}
                <button
                  type="button"
                  className="text-xs text-signal hover:underline"
                  onClick={() => setEngines(DEFAULT_ENGINE_IDS)}
                >
                  Włącz wszystkie
                </button>
              </div>
            )}
          </div>
        </form>

        {!result && !loading && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.query}
                type="button"
                onClick={() => {
                  setQuery(ex.query);
                  setMode(ex.mode);
                  void runSearch(ex.query, ex.mode);
                }}
                className="rounded-full border border-border bg-bg-elevated/80 px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
              >
                {ex.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {loading && (
        <div className="mx-auto mb-8 max-w-3xl animate-rise">
          <EnginePipeline simulating activeIds={engines} />
          <p className="mt-4 text-center text-sm text-fg-muted">
            Discovery · crawl · ekstrakcja
            {useAi && aiAvailable ? " · synteza Grok…" : "…"}
          </p>
        </div>
      )}

      {error && !loading && (
        <div className="mx-auto mb-8 max-w-xl rounded-[var(--radius-lg)] border border-danger/30 bg-danger/10 px-4 py-3 text-center text-sm text-danger">
          {error}
        </div>
      )}

      {result && !loading && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-fg-subtle">
              Zapytanie: <span className="text-fg-muted">{result.query}</span>
              {" · "}
              {formatDuration(result.totalDurationMs)}
              {" · skuteczność "}
              <span className="text-fg-muted">
                {result.effectiveness.score}/100 ({result.effectiveness.grade})
              </span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setResult(null);
                setError(null);
              }}
            >
              Nowe wyszukiwanie
            </Button>
          </div>
          <ResultsPanel result={result} />
        </div>
      )}

      {!result && !loading && (
        <div className="mx-auto mt-4 grid max-w-5xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <EnginePipeline activeIds={engines} />

          <div className="space-y-4">
            <HowToSearchCard aiAvailable={aiAvailable} />

            <div className="rounded-[var(--radius-xl)] border border-border bg-surface/60 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <History className="h-4 w-4 text-fg-subtle" />
                <h2 className="text-sm font-semibold text-fg">Historia</h2>
              </div>
              {history.length === 0 ? (
                <p className="text-sm text-fg-subtle">
                  Twoje skany pojawią się tutaj. Spróbuj przykładu lub wklej URL.
                </p>
              ) : (
                <ul className="space-y-1">
                  {history.map((h) => (
                    <li key={h.at + h.query}>
                      <button
                        type="button"
                        onClick={() => {
                          setQuery(h.query);
                          setMode(h.mode);
                          void runSearch(h.query, h.mode);
                        }}
                        className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left text-sm hover:bg-bg-elevated"
                      >
                        <Clock className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                        <span className="min-w-0 flex-1 truncate text-fg-muted">{h.query}</span>
                        <Badge variant="default" className="shrink-0 capitalize">
                          {h.mode}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function HowToSearchCard({ aiAvailable }: { aiAvailable: boolean | null }) {
  return (
    <div className="rounded-[var(--radius-xl)] border border-border bg-surface/60 p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-fg-subtle" />
        <h2 className="text-sm font-semibold text-fg">Jak szukać</h2>
      </div>
      <ol className="space-y-2.5 text-sm text-fg-muted">
        <li>
          <span className="font-medium text-fg">1. Zapytanie</span> — discovery (Wikipedia +
          DuckDuckGo) i głęboki scrape top stron.
        </li>
        <li>
          <span className="font-medium text-fg">2. URL</span> — wklej adres; pełny pipeline na
          jednej stronie (najskuteczniejsze).
        </li>
        <li>
          <span className="font-medium text-fg">3. Deep</span> — multi-page: idzie też w linki
          wewnętrzne.
        </li>
        <li>
          <span className="font-medium text-fg">4. Grok</span> —{" "}
          {aiAvailable
            ? "włączony: synteza odpowiedzi z wyciągniętych źródeł."
            : "opcjonalny. Dodaj XAI_API_KEY w env Vercel (po publish). Bez klucza crawl działa dalej."}
        </li>
      </ol>
      <div className="mt-4 rounded-[var(--radius-md)] border border-border/80 bg-bg-elevated px-3 py-2.5 text-xs leading-relaxed text-fg-subtle">
        <p className="font-medium text-fg-muted">Skuteczność (orientacyjnie)</p>
        <p className="mt-1">URL / dokumentacja publiczna: bardzo wysoka.</p>
        <p>Zapytania ogólne: dobra (zależna od discovery + blokad).</p>
        <p>SPA za logowaniem / silny antybot: ograniczona bez headless browser.</p>
      </div>
    </div>
  );
}
