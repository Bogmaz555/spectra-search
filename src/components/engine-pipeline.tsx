import { AlertTriangle, Check, Circle, Loader2, Minus } from "lucide-react";
import { ENGINES, ENGINE_MAP, type EngineId } from "@/lib/engines";
import type { EngineRun } from "@/lib/scrape/types";
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

export function EnginePipeline({
  runs,
  simulating,
  activeIds,
}: {
  runs?: EngineRun[];
  simulating?: boolean;
  activeIds?: EngineId[];
}) {
  const byId = new Map(runs?.map((r) => [r.id, r]));
  const enabled = new Set(activeIds ?? ENGINES.map((e) => e.id));

  return (
    <div className="rounded-[var(--radius-xl)] border border-border bg-surface/60 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-fg">Adaptery</h2>
          <p className="text-xs text-fg-subtle">
            Live = prawdziwe API. Aproksymacja jest podpisana. Reszta jest pominięta.
          </p>
        </div>
        {simulating && (
          <Badge variant="signal" className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-signal engine-running" />
            Skanowanie
          </Badge>
        )}
      </div>

      <ol className="grid gap-2 sm:grid-cols-2">
        {ENGINES.map((engine, i) => {
          const run = byId.get(engine.id);
          const isEnabled = enabled.has(engine.id);
          const status = !isEnabled
            ? "skipped"
            : (run?.status ?? (simulating ? (i === 0 ? "running" : "pending") : "pending"));

          return (
            <li
              key={engine.id}
              className={cn(
                "flex items-start gap-3 rounded-[var(--radius-lg)] border border-border/80 bg-bg-elevated/80 p-3 transition-opacity duration-200",
                !isEnabled && "opacity-40",
                status === "running" && "border-signal/40",
                status === "live" && "border-success/25",
                status === "degraded" && "border-warn/40",
                status === "error" && "border-danger/30",
              )}
            >
              <span
                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[10px] font-semibold text-bg"
                style={{
                  backgroundColor: ENGINE_CSS[engine.color] ?? "var(--color-fg-muted)",
                }}
              >
                {String(engine.order).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-fg">{engine.name}</p>
                  <StatusIcon status={status} />
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-fg-subtle">
                  {run?.message || engine.runtimeNote}
                </p>
                {run && (run.status === "live" || run.status === "degraded" || run.status === "error") && (
                  <p className="mt-1 font-mono text-[10px] text-fg-subtle">
                    {statusLabel(run.status)}
                    {run.durationMs ? ` · ${formatDuration(run.durationMs)}` : ""}
                    {run.itemsFound != null ? ` · ${run.itemsFound} el.` : ""}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === "live") return "live";
  if (status === "degraded") return "aproksymacja";
  if (status === "error") return "błąd";
  if (status === "skipped") return "pominięty";
  return status;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "running")
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-signal" />;
  if (status === "live") return <Check className="h-3.5 w-3.5 shrink-0 text-success" />;
  if (status === "degraded")
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />;
  if (status === "error") return <Circle className="h-3.5 w-3.5 shrink-0 text-danger" />;
  if (status === "skipped") return <Minus className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-fg-subtle/50" />;
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
      {eng.name}
    </button>
  );
}
