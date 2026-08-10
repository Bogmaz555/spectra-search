import {
  CheckCircle2,
  ExternalLink,
  FileJson,
  Globe,
  Image as ImageIcon,
  Link2,
  Smartphone,
  Sparkles,
  Type,
  XCircle,
} from "lucide-react";
import type { SpectraResult, SourceResult } from "@/lib/scrape/types";
import { cn, formatDuration, truncate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownView } from "@/components/markdown-view";
import { EnginePipeline } from "@/components/engine-pipeline";

export function ResultsPanel({ result }: { result: SpectraResult }) {
  const primary = result.sources[0];
  const gradeColor =
    result.effectiveness.grade === "A" || result.effectiveness.grade === "B"
      ? "text-success"
      : result.effectiveness.grade === "C"
        ? "text-warn"
        : "text-danger";

  return (
    <div className="animate-rise space-y-6">
      {/* AI answer */}
      {result.ai.used && result.ai.answer ? (
        <section className="rounded-[var(--radius-xl)] border border-signal/30 bg-signal/5 p-5 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="signal" className="gap-1.5">
              <Sparkles className="h-3 w-3" />
              Grok · {result.ai.model}
            </Badge>
            <Badge variant="default">
              pewność {(result.ai.confidence * 100).toFixed(0)}%
            </Badge>
          </div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-fg sm:text-xl">
            Odpowiedź z syntezy źródeł
          </h2>
          <div className="mt-3">
            <MarkdownView source={result.ai.answer} />
          </div>
          {result.ai.keyPoints.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-border/80 pt-4">
              {result.ai.keyPoints.map((p) => (
                <li key={p} className="flex gap-2 text-sm text-fg-muted">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
          {result.ai.citations.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {result.ai.citations.map((c) => (
                <a
                  key={c.url}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-fg-muted hover:border-signal/40 hover:text-signal"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{c.title}</span>
                </a>
              ))}
            </div>
          )}
        </section>
      ) : result.ai.error ? (
        <section className="rounded-[var(--radius-xl)] border border-border bg-surface/50 px-4 py-3 text-sm text-fg-muted">
          <span className="font-medium text-fg">Grok: </span>
          {result.ai.error}
        </section>
      ) : null}

      <section className="rounded-[var(--radius-xl)] border border-border bg-surface/70 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="signal">
                {result.resolvedMode === "url"
                  ? "Crawl URL"
                  : result.resolvedMode === "deep"
                    ? "Deep crawl"
                    : "Wyszukiwanie"}
              </Badge>
              <Badge variant="default">{result.hits.length} trafień</Badge>
              <Badge variant="default">{result.sources.length} źródeł</Badge>
              <Badge variant="default">{formatDuration(result.totalDurationMs)}</Badge>
              {result.ai.used && <Badge variant="signal">AI on</Badge>}
            </div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              {primary?.title || result.query}
            </h2>
            <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
              {result.summary.replace(/\*\*/g, "")}
            </p>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-fg-subtle">Skuteczność</p>
            <p className={cn("font-display text-3xl font-semibold tabular-nums", gradeColor)}>
              {result.effectiveness.score}
            </p>
            <p className={cn("text-xs font-medium", gradeColor)}>
              ocena {result.effectiveness.grade}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {result.hits.length > 0 && (
            <section className="rounded-[var(--radius-xl)] border border-border bg-surface/60 p-4 sm:p-5">
              <h3 className="mb-3 text-sm font-semibold text-fg">Wyniki discovery</h3>
              <ul className="space-y-2">
                {result.hits.map((hit) => (
                  <li key={hit.url}>
                    <a
                      href={hit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-3 rounded-[var(--radius-lg)] border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-bg-elevated"
                    >
                      <Globe className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle group-hover:text-signal" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg group-hover:text-signal">
                          {hit.title}
                        </p>
                        <p className="truncate font-mono text-[11px] text-fg-subtle">{hit.url}</p>
                        {hit.snippet && (
                          <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{hit.snippet}</p>
                        )}
                      </div>
                      <Badge variant="default" className="ml-auto shrink-0 capitalize">
                        {hit.source}
                      </Badge>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.sources.map((source, idx) => (
            <SourceCard key={source.url + idx} source={source} index={idx} />
          ))}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <EnginePipeline runs={result.engines} />
          <EffectivenessCard result={result} />
          {primary && <SourceStats source={primary} />}
        </aside>
      </div>
    </div>
  );
}

function EffectivenessCard({ result }: { result: SpectraResult }) {
  return (
    <div className="rounded-[var(--radius-xl)] border border-border bg-surface/60 p-4">
      <h3 className="mb-3 text-sm font-semibold text-fg">Raport skuteczności</h3>
      <ul className="space-y-2">
        {result.effectiveness.factors.map((f) => (
          <li key={f.label} className="flex items-start gap-2 text-xs">
            {f.ok ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            )}
            <div>
              <p className="font-medium text-fg">{f.label}</p>
              <p className="text-fg-subtle">{f.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceStats({ source }: { source: SourceResult }) {
  const stats = [
    { label: "Słowa", value: source.wordCount.toLocaleString("pl-PL") },
    { label: "Linki", value: String(source.links.length) },
    { label: "Media", value: String(source.media.length) },
    { label: "Status", value: String(source.statusCode || "—") },
  ];
  return (
    <div className="rounded-[var(--radius-xl)] border border-border bg-surface/60 p-4">
      <h3 className="mb-3 text-sm font-semibold text-fg">Metryki źródła</h3>
      <dl className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated px-3 py-2"
          >
            <dt className="text-[10px] uppercase tracking-wider text-fg-subtle">{s.label}</dt>
            <dd className="font-mono text-sm font-medium tabular-nums text-fg">{s.value}</dd>
          </div>
        ))}
      </dl>
      {source.mobile.isMobileOptimized && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-muted">
          <Smartphone className="h-3.5 w-3.5 text-engine-mobile" />
          Optymalizacja mobile
        </p>
      )}
    </div>
  );
}

function SourceCard({ source, index }: { source: SourceResult; index: number }) {
  return (
    <section
      className="animate-rise overflow-hidden rounded-[var(--radius-xl)] border border-border bg-surface/70"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
              Źródło {index + 1}
            </p>
            <h3 className="mt-0.5 text-base font-semibold tracking-tight text-fg sm:text-lg">
              {source.title}
            </h3>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-signal hover:underline"
            >
              {truncate(source.url, 72)}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <Badge variant={source.statusCode && source.statusCode < 400 ? "success" : "warn"}>
            HTTP {source.statusCode || "—"}
          </Badge>
        </div>
        {source.description && (
          <p className="mt-2 text-sm text-fg-muted">{source.description}</p>
        )}
      </div>

      <div className="px-4 py-4 sm:px-5">
        <Tabs defaultValue="markdown">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="markdown" className="gap-1.5">
              <Type className="h-3.5 w-3.5" /> Markdown
            </TabsTrigger>
            <TabsTrigger value="structure" className="gap-1.5">
              <FileJson className="h-3.5 w-3.5" /> Struktura
            </TabsTrigger>
            <TabsTrigger value="links" className="gap-1.5">
              <Link2 className="h-3.5 w-3.5" /> Linki
            </TabsTrigger>
            <TabsTrigger value="media" className="gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" /> Media
            </TabsTrigger>
            <TabsTrigger value="patterns" className="gap-1.5">
              Wzorce
            </TabsTrigger>
          </TabsList>

          <TabsContent value="markdown">
            <div className="max-h-[28rem] overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-4">
              <MarkdownView source={source.markdown} />
            </div>
          </TabsContent>

          <TabsContent value="structure">
            <div className="max-h-[28rem] space-y-2 overflow-y-auto">
              {source.structured.length === 0 ? (
                <p className="text-sm text-fg-subtle">Brak pól strukturalnych.</p>
              ) : (
                source.structured.map((f, i) => (
                  <div
                    key={`${f.key}-${i}`}
                    className="grid gap-1 rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3 py-2 sm:grid-cols-[160px_1fr]"
                  >
                    <span className="font-mono text-[11px] text-signal">{f.key}</span>
                    <span className="break-all text-sm text-fg-muted">{f.value}</span>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="links">
            <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
              {source.links.slice(0, 50).map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-sm hover:bg-bg-elevated"
                  >
                    <Badge variant={l.external ? "default" : "signal"} className="shrink-0">
                      {l.external ? "ext" : "int"}
                    </Badge>
                    <span className="min-w-0 truncate text-fg-muted">{l.text}</span>
                  </a>
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="media">
            {source.media.length === 0 ? (
              <p className="text-sm text-fg-subtle">Brak mediów.</p>
            ) : (
              <div className="grid max-h-[28rem] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                {source.media
                  .filter((m) => m.type === "image" || m.type === "icon")
                  .slice(0, 18)
                  .map((m) => (
                    <a
                      key={m.src}
                      href={m.src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative aspect-video overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-elevated"
                    >
                      <img
                        src={m.src}
                        alt={m.alt || ""}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </a>
                  ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="patterns">
            {source.patterns.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nie wykryto powtarzalnych wzorców.</p>
            ) : (
              <div className="space-y-3">
                {source.patterns.map((p) => (
                  <div
                    key={p.label}
                    className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-fg">{p.label}</p>
                      <Badge variant="default">
                        {(p.confidence * 100).toFixed(0)}% conf.
                      </Badge>
                    </div>
                    <ul className="space-y-1">
                      {p.items.map((item) => (
                        <li key={item} className="text-xs text-fg-muted">
                          · {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
