import type { DiscoveryRun } from "./types.ts";

/** Hits win. Any transport failure with no hits is an error. An empty but answered source is skipped. */
export function hitOutcome(
  hits: number,
  failed: number,
  attempts: number,
): Extract<DiscoveryRun["status"], "live" | "error" | "skipped"> {
  if (hits > 0) return "live";
  if (failed > 0 && attempts > 0) return "error";
  return "skipped";
}

export function emptySourceMessage(input: {
  hits: number;
  failed: number;
  attempts: number;
  filled: string;
  allFailed: string;
  partial: string;
  empty: string;
}): string {
  if (input.hits > 0) return input.filled;
  if (input.attempts > 0 && input.failed >= input.attempts) return input.allFailed;
  if (input.failed > 0) return input.partial;
  return input.empty;
}
