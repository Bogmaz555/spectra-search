import { Check, Circle, Loader2, Minus } from "lucide-react";
import { CAPEX_SOURCES, OUTSIDE_SEARCH, QUERY_SOURCES } from "@/lib/catalog";
import { CASCADE_STEPS } from "@/lib/scrape/cascade";
import { ENGINE_MAP, type EngineId } from "@/lib/engines";
import type { DiscoveryRun, EngineRun, ResearchStage } from "@/lib/scrape/types";
import { cn, formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const ENGINE_CSS: Record<string, string> = {
  "engine-fetch": "var(--color-engine-fetch)",
  "engine-adapt": "var(--color-engine-adapt)",
  "engine-render": "var(--color-engine-render)",
  "engine-queue": "var(--color-engine-queue)",
  "engine-scale": "var(--color-engine-scale)",
  "engine-pattern": "var(--color-engine-pattern)",
  "engine-structure": "var(--color-engine-structure)",
  "engine-markdown": "var(--color-engine-markdown)",
  "engine-doc": "var(--color-engine-doc)",
  "engine-mobile": "var(--color-engine-mobile)",
};

export function statusLabel(status: string): string {
  if (status === "live") return "działa";
  if (status === "local") return "krok lokalny";
  if (status === "degraded") return "częściowo";
  if (status === "error") return "błąd";
  if (status === "skipped") return "pominięte";
  if (status === "not_applicable") return "nie dotyczy";
  if (status === "running") return "w toku";
  return "czeka";
}

export function discoveryBadge(run: DiscoveryRun): {
  variant: "success" | "danger" | "default" | "warn";
  label: string;
} {
  if (run.status === "error") return { variant: "danger", label: "błąd" };
  if (run.status === "not_applicable") return { variant: "default", label: "nie dotyczy" };
  if (run.status === "skipped") return { variant: "default", label: "pominięte" };
  if (run.hits === 0) return { variant: "default", label: "0 trafień" };
  return { variant: "success", label: String(run.hits) };
}

function StatusIcon({ status }: { status: string }) {
  if (status === "running")
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-signal" />;
  if (status === "live") return <Check className="h-3.5 w-3.5 shrink-0 text-success" />;
  if (status === "local") return <Check className="h-3.5 w-3.5 shrink-0 text-signal" />;
  if (status === "degraded") return <Circle className="h-3.5 w-3.5 shrink-0 text-warn" />;
  if (status === "error") return <Circle className="h-3.5 w-3.5 shrink-0 text-danger" />;
  return <Minus className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />;
}

export function IdleSourceGuide() {
  const free = QUERY_SOURCES.filter((source) => source.tier === "free");
  const optional = QUERY_SOURCES.filter((source) => source.tier === "optional");
  return (
    <div className="rounded-[var(--radius-xl)] border border-border bg-surface/60 p-4 sm:p-5">
      <h2 className="text-sm font-semibold tracking-tight text-fg">Źródła wyszukiwania</h2>
      <p className="mt-1 text-xs leading-relaxed text-fg-subtle">
        Zapytanie tekstowe idzie do źródeł poniżej. Nazwy bibliotek z GitHuba nie są osobnymi
        wyszukiwarkami.
      </p>
      <ul className="mt-3 space-y-1.5">
        {free.map((source) => (
          <li key={source.id} className="text-xs leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">{source.label}.</span> {source.detail}
          </li>
        ))}
      </ul>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-fg-subtle">
        Opcjonalne klucze
      </h3>
      <ul className="mt-2 space-y-1.5">
        {optional.map((source) => (
          <li key={source.id} className="text-xs leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">{source.label}</span>
            {source.envKey ? <span className="font-mono text-fg-subtle"> ({source.envKey})</span> : null}
            . {source.detail}
          </li>
        ))}
      </ul>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-fg-subtle">
        Firma / CapEx
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">
        {CAPEX_SOURCES.map((source) => source.label).join(", ")} — tylko w tym trybie. Pusta
        odpowiedź RSS nie jest błędem.
      </p>
      <ol className="mt-4 space-y-1.5 border-t border-border/70 pt-3">
        {CASCADE_STEPS.map((step) => (
          <li key={step.id} className="text-xs leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">{step.label}.</span> {step.role}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
        {OUTSIDE_SEARCH.map((item) => item.label).join(", ")} nie wchodzą do tej kaskady. scrcpy
        dotyczy tylko Androida przez ADB i nie wnosi nic do badania stron.
      </p>
    </div>
  );
}

export function CascadePanel({ stages }: { stages: ResearchStage[] }) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-surface/70 p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-fg">Kaskada badania</h3>
      <p className="mt-1 text-xs text-fg-subtle">
        Każdy etap mówi, co dostał, co oddał i czy w ogóle był potrzebny. Płatne API nie startują,
        gdy tanie pobranie już ma treść.
      </p>
      <ol className="mt-3 space-y-2">
        {stages.map((stage, index) => (
          <li
            key={stage.id}
            className="rounded-[var(--radius-lg)] border border-border/80 bg-bg-elevated px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-fg">
                {index + 1}. {stage.label}
              </p>
              <Badge variant={stageBadge(stage.status)}>{statusLabel(stage.status)}</Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{stage.contribution}</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{stage.output}</p>
            {stage.reason ? (
              <p className="mt-1 text-xs leading-relaxed text-fg-subtle">Powód: {stage.reason}</p>
            ) : null}
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-fg-subtle">
              {stage.provenance}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function stageBadge(
  status: ResearchStage["status"],
): "success" | "signal" | "danger" | "default" {
  if (status === "live") return "success";
  if (status === "local") return "signal";
  if (status === "error") return "danger";
  return "default";
}

export function ProcessingPanel({ runs }: { runs: EngineRun[] }) {
  const notable = runs.filter(
    (run) => run.status === "live" || run.status === "local" || run.status === "error" || run.status === "degraded",
  );
  const quiet = runs.filter((run) => run.status === "skipped" || run.status === "not_applicable");
  return (
    <div className="rounded-[var(--radius-xl)] border border-border bg-surface/60 p-4 sm:p-5">
      <h2 className="text-sm font-semibold tracking-tight text-fg">Przetwarzanie stron</h2>
      <p className="mt-1 text-xs text-fg-subtle">
        Kroki lokalne i opcjonalne usługi. „Działa” oznacza prawdziwe API. „Krok lokalny” oznacza
        własny kod SPECTRA.
      </p>
      {notable.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-fg-muted">
          Żaden krok pobrania się nie wykonał — nie było strony do obróbki albo wszystkie zostały
          wyłączone.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notable.map((run) => (
            <ProcessingRow key={run.id} run={run} />
          ))}
        </ul>
      )}
      {quiet.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-border/70 pt-3">
          {quiet.map((run) => (
            <li key={run.id} className="text-xs leading-relaxed text-fg-subtle">
              <span className="font-medium text-fg-muted">{ENGINE_MAP[run.id].searchLabel}:</span>{" "}
              {statusLabel(run.status)}. {run.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProcessingRow({ run }: { run: EngineRun }) {
  const engine = ENGINE_MAP[run.id];
  const warn = run.status === "error" || run.status === "degraded";
  return (
    <li
      className={cn(
        "rounded-[var(--radius-lg)] border border-border/80 bg-bg-elevated/80 p-3",
        run.status === "live" && "border-success/25",
        run.status === "error" && "border-danger/30",
        run.status === "degraded" && "border-warn/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg">{engine.searchLabel}</p>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-fg-subtle">
          <StatusIcon status={run.status} />
          {statusLabel(run.status)}
        </span>
      </div>
      <p className={cn("mt-1 text-xs leading-relaxed", warn ? "text-fg-muted" : "text-fg-subtle")}>
        {run.message}
      </p>
      {(run.durationMs > 0 || run.itemsFound != null) && (
        <p className="mt-1 font-mono text-[10px] text-fg-subtle">
          {run.durationMs > 0 ? formatDuration(run.durationMs) : ""}
          {run.itemsFound != null ? `${run.durationMs > 0 ? " · " : ""}${run.itemsFound} el.` : ""}
        </p>
      )}
    </li>
  );
}

export function EngineChip({
  id,
  onToggle,
  active,
}: {
  id: EngineId;
  onToggle: () => void;
  active: boolean;
}) {
  const eng = ENGINE_MAP[id];
  return (
    <button
      type="button"
      onClick={onToggle}
      title={eng.runtimeNote}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150",
        active
          ? "border-border-strong bg-surface-2 text-fg"
          : "border-border bg-transparent text-fg-subtle hover:text-fg-muted",
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: ENGINE_CSS[eng.color] ?? "var(--color-fg-muted)" }}
      />
      {eng.searchLabel}
    </button>
  );
}
