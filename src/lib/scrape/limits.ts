/** Budgets chosen so a Pro Vercel function (60s) can finish; work stops early on the deadline. */
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
