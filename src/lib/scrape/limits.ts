/**
 * Crawl work stops on `searchBudgetMs`. Grok synthesis gets its own ceiling
 * (`SYNTHESIS_TIMEOUT_MS`) and both must finish inside `FUNCTION_MAX_DURATION_SEC`
 * with `FUNCTION_SAFETY_MS` left so we abort ourselves before Vercel kills the
 * invocation. Hobby Fluid allows 300s; 180s is the cap we set on the function.
 */
export const FUNCTION_MAX_DURATION_SEC = 180;
/** grok-4.3 (default reasoning effort low) did not return inside the old 12s abort. */
export const SYNTHESIS_TIMEOUT_MS = 90_000;
/** Stay under the platform cap so the Polish abort wins over a platform 504. */
export const FUNCTION_SAFETY_MS = 12_000;
/** Below this, starting a reasoning call would only reproduce a short abort. */
export const MIN_SYNTHESIS_MS = 20_000;

/**
 * Abort budget for one Grok call after `elapsedMs` of crawl work.
 * Returns 0 when the remaining function time cannot hold a useful call.
 */
export function synthesisAbortMs(elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const remain = FUNCTION_MAX_DURATION_SEC * 1000 - elapsed - FUNCTION_SAFETY_MS;
  if (remain < MIN_SYNTHESIS_MS) return 0;
  return Math.min(SYNTHESIS_TIMEOUT_MS, remain);
}

export const LIMITS = {
  discoveryPerSource: 6,
  fusedHitsCap: 36,
  defaultMaxPagesSearch: 6,
  defaultMaxPagesDeep: 10,
  hardMaxPages: 12,
  deepSeedPages: 4,
  scrapeConcurrency: 3,
  fetchTimeoutMs: 9_000,
  discoveryTimeoutMs: 7_000,
  firecrawlTimeoutMs: 14_000,
  browserUseTimeoutMs: 12_000,
  crawl4aiTimeoutMs: 12_000,
  robotsTimeoutMs: 3_500,
  maxRedirects: 5,
  maxBodyBytes: 1_500_000,
  searchBudgetMs: 45_000,
  browserUseCap: 2,
  firecrawlCap: 10,
  crawl4aiCap: 8,
} as const;

export function clampPages(n: number | undefined, fallback: number): number {
  const raw = n ?? fallback;
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(LIMITS.hardMaxPages, Math.max(1, Math.floor(raw)));
}
