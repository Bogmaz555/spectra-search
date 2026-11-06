import type { EngineId } from "../engines.ts";
import type { EngineRun, EngineStatus } from "./types.ts";

const RANK: Record<EngineStatus, number> = {
  live: 7,
  local: 6,
  degraded: 5,
  error: 4,
  skipped: 3,
  not_applicable: 2,
  running: 1,
  pending: 0,
};

function winningStatus(runs: EngineRun[]): EngineStatus {
  if (runs.some((r) => r.status === "live")) return "live";
  if (runs.some((r) => r.status === "local")) return "local";
  if (runs.some((r) => r.status === "degraded")) return "degraded";
  if (runs.some((r) => r.status === "error")) return "error";
  if (runs.some((r) => r.status === "skipped")) return "skipped";
  if (runs.some((r) => r.status === "not_applicable")) return "not_applicable";
  if (runs.some((r) => r.status === "running")) return "running";
  return "pending";
}

export function summarizeRuns(id: EngineId, runs: EngineRun[]): EngineRun {
  if (!runs.length) {
    return { id, status: "skipped", durationMs: 0, message: "Brak uruchomienia" };
  }
  const status = winningStatus(runs);
  const relevant = runs.filter((r) => r.status === status);
  const sample = relevant[0] ?? runs[0];
  const items = runs.reduce((sum, run) => sum + (run.itemsFound ?? 0), 0);
  const durationMs = Math.round(runs.reduce((sum, run) => sum + run.durationMs, 0) / runs.length);
  const extra = runs.length > 1 ? ` · ${runs.length} stron` : "";
  return {
    id,
    status,
    durationMs,
    message: `${sample.message}${extra}`,
    itemsFound: items || undefined,
  };
}

/** Never promotes a skipped adapter to live. Live wins only if some run was live. */
export function aggregateEngineRuns(runs: EngineRun[]): EngineRun[] {
  const byId = new Map<EngineId, EngineRun[]>();
  for (const run of runs) {
    const list = byId.get(run.id) ?? [];
    list.push(run);
    byId.set(run.id, list);
  }
  return [...byId.entries()]
    .sort((a, b) => RANK[winningStatus(b[1])] - RANK[winningStatus(a[1])])
    .map(([id, list]) => summarizeRuns(id, list));
}
