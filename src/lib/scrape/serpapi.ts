import { canonicalUrl, type RankableHit } from "./rank.ts";
import { SPECTRA_UA } from "./http.ts";
import { LIMITS } from "./limits.ts";

export const SERPAPI_ENV_KEY = "SERPAPI_API_KEY";
export const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
export const SERPAPI_ACCOUNT = "https://serpapi.com/account.json";

type Env = Record<string, string | undefined>;

export function hasSerpapiKey(env: Env = process.env): boolean {
  return Boolean(env[SERPAPI_ENV_KEY]?.trim());
}

export function getSerpapiStatus(env: Env = process.env): {
  available: boolean;
  note: string;
} {
  const available = hasSerpapiKey(env);
  return {
    available,
    note: available
      ? "SerpAPI aktywne"
      : "Ustaw SERPAPI_API_KEY na Vercel, aby włączyć SerpAPI",
  };
}

/** Per-scan budget so Free Plan searches stay bounded. */
export class SerpapiBudget {
  readonly maxCalls: number;
  used = 0;
  lastError?: string;
  remainingQuota: number | null = null;

  constructor(maxCalls: number = LIMITS.serpapiCap) {
    this.maxCalls = Math.max(0, Math.floor(maxCalls));
  }

  get remainingCalls(): number {
    return Math.max(0, this.maxCalls - this.used);
  }

  tryConsume(): boolean {
    if (this.used >= this.maxCalls) return false;
    this.used += 1;
    return true;
  }
}

export interface SerpapiSearchOpts {
  engine: "google" | "google_news";
  query: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  limit?: number;
  gl?: string;
  hl?: string;
  budget?: SerpapiBudget;
}

export function parseSerpapiGoogle(json: unknown, source: string, limit: number): RankableHit[] {
  if (!json || typeof json !== "object") return [];
  const root = json as {
    organic_results?: { title?: string; link?: string; snippet?: string }[];
    error?: string;
  };
  if (root.error) throw new Error(String(root.error).slice(0, 180));
  const hits: RankableHit[] = [];
  for (const item of root.organic_results ?? []) {
    if (hits.length >= limit) break;
    const canon = item.link ? canonicalUrl(item.link) : null;
    if (!canon || !item.title) continue;
    hits.push({
      title: item.title,
      url: canon,
      snippet: (item.snippet || "").slice(0, 280),
      source,
    });
  }
  return hits;
}

export function parseSerpapiGoogleNews(json: unknown, source: string, limit: number): RankableHit[] {
  if (!json || typeof json !== "object") return [];
  const root = json as {
    news_results?: { title?: string; link?: string; snippet?: string; source?: string; date?: string }[];
    error?: string;
  };
  if (root.error) throw new Error(String(root.error).slice(0, 180));
  const hits: RankableHit[] = [];
  for (const item of root.news_results ?? []) {
    if (hits.length >= limit) break;
    const canon = item.link ? canonicalUrl(item.link) : null;
    if (!canon || !item.title) continue;
    const meta = [item.source, item.date].filter(Boolean).join(" · ");
    hits.push({
      title: item.title,
      url: canon,
      snippet: (item.snippet || meta || "Google News").slice(0, 280),
      source,
    });
  }
  return hits;
}

export async function serpapiSearch(opts: SerpapiSearchOpts): Promise<RankableHit[]> {
  const budget = opts.budget;
  if (budget && !budget.tryConsume()) {
    const err = new Error(`SerpAPI budget exhausted (${budget.maxCalls}/scan)`);
    budget.lastError = err.message;
    throw err;
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const limit = opts.limit ?? LIMITS.discoveryPerSource;
  const gl = opts.gl ?? "pl";
  const hl = opts.hl ?? "pl";
  const timeoutMs = opts.timeoutMs ?? LIMITS.discoveryTimeoutMs;
  const params = new URLSearchParams({
    engine: opts.engine,
    q: opts.query,
    api_key: opts.apiKey,
    gl,
    hl,
    num: String(Math.min(20, Math.max(1, limit))),
  });

  const signal = opts.signal ?? AbortSignal.timeout(timeoutMs);
  const res = await fetchImpl(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
    method: "GET",
    signal,
    headers: {
      Accept: "application/json",
      "User-Agent": SPECTRA_UA,
    },
  });
  const text = await res.text();
  if (res.status === 429) {
    const err = new Error("SerpAPI HTTP 429 — limit / rate");
    if (budget) budget.lastError = err.message;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`SerpAPI HTTP ${res.status}: ${text.slice(0, 120)}`);
    if (budget) budget.lastError = err.message;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error("SerpAPI: niepoprawny JSON");
  }
  const source = opts.engine === "google_news" ? "serpapi-news" : "serpapi";
  return opts.engine === "google_news"
    ? parseSerpapiGoogleNews(json, source, limit)
    : parseSerpapiGoogle(json, source, limit);
}

/** Cheap account.json read for remaining quota (does not count as a search). */
export async function fetchSerpapiQuota(
  apiKey: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<number | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${SERPAPI_ACCOUNT}?api_key=${encodeURIComponent(apiKey)}`, {
      headers: { Accept: "application/json", "User-Agent": SPECTRA_UA },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 4_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { total_searches_left?: number };
    return typeof json.total_searches_left === "number" ? json.total_searches_left : null;
  } catch {
    return null;
  }
}
