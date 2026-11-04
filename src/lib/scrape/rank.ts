export interface RankableHit {
  title: string;
  url: string;
  snippet: string;
  source: string;
  score?: number;
}

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "yclid",
  "twclid",
  "ref_src",
  "_ga",
  "spm",
]);

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "i",
  "w",
  "z",
  "na",
  "do",
  "od",
  "po",
  "za",
  "o",
  "się",
  "sie",
  "jak",
  "czy",
  "oraz",
  "jest",
  "to",
  "nie",
]);

export function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Canonical http(s) URL: lowercase host, no hash, no tracking params, no trailing slash. */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const kept: [string, string][] = [];
    for (const [key, value] of u.searchParams.entries()) {
      const k = key.toLowerCase();
      if (TRACKING_PARAMS.has(k) || k.startsWith("utm_")) continue;
      kept.push([key, value]);
    }
    kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    u.search = "";
    for (const [key, value] of kept) u.searchParams.append(key, value);
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return null;
  }
}

export function queryTokens(query: string): string[] {
  const parts = query
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
  return [...new Set(parts)];
}

/** 0..1 overlap of query tokens with title (weighted) and snippet. */
export function queryOverlap(query: string, hit: { title: string; snippet: string }): number {
  const tokens = queryTokens(query);
  if (!tokens.length) return 0;
  const title = hit.title.toLowerCase();
  const snippet = hit.snippet.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 1;
    else if (snippet.includes(token)) score += 0.45;
  }
  return Math.min(1, score / tokens.length);
}

export function dedupeHits(hits: RankableHit[]): RankableHit[] {
  const seen = new Set<string>();
  const out: RankableHit[] = [];
  for (const hit of hits) {
    const key = canonicalUrl(hit.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...hit, url: key });
  }
  return out;
}

/**
 * Reciprocal rank fusion across provider lists, plus a light lexical overlap.
 * Same canonical URL keeps the longest snippet and joins provider ids.
 */
export function fuseHits(
  groups: { source: string; hits: RankableHit[] }[],
  query: string,
): RankableHit[] {
  const K = 60;
  const map = new Map<
    string,
    { hit: RankableHit; score: number; providers: string[] }
  >();

  for (const group of groups) {
    const unique = dedupeHits(group.hits);
    unique.forEach((hit, rank) => {
      const key = hit.url;
      const rrf = 1 / (K + rank + 1);
      const lexical = queryOverlap(query, hit) * 0.35;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          hit: { ...hit, source: group.source },
          score: rrf + lexical,
          providers: [group.source],
        });
        return;
      }
      prev.score += rrf + lexical * 0.25;
      if (!prev.providers.includes(group.source)) prev.providers.push(group.source);
      if (hit.snippet.length > prev.hit.snippet.length) prev.hit.snippet = hit.snippet;
      if (hit.title.length > prev.hit.title.length) prev.hit.title = hit.title;
    });
  }

  const ranked = [...map.values()].sort((a, b) => b.score - a.score);
  const hostSeen = new Map<string, number>();
  for (const item of ranked) {
    const host = hostnameOf(item.hit.url);
    const seen = hostSeen.get(host) ?? 0;
    hostSeen.set(host, seen + 1);
    if (seen > 0) item.score *= Math.pow(0.78, seen);
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map(({ hit, score, providers }) => ({
    ...hit,
    source: providers.join("+"),
    score,
  }));
}

/**
 * Pick URLs for scraping with a per-host cap so one domain cannot fill the budget.
 * If the cap would leave slots empty, it relaxes until the limit is filled.
 */
export function selectDiverse<T extends { url: string }>(
  hits: T[],
  limit: number,
  maxPerHost = 2,
): T[] {
  if (limit <= 0) return [];
  const picked: T[] = [];
  const seen = new Set<string>();
  let cap = Math.max(1, maxPerHost);
  while (picked.length < limit && cap < 50) {
    const hostCount = new Map<string, number>();
    for (const item of picked) {
      const host = hostnameOf(item.url);
      hostCount.set(host, (hostCount.get(host) ?? 0) + 1);
    }
    let progressed = false;
    for (const hit of hits) {
      if (picked.length >= limit) break;
      const key = canonicalUrl(hit.url) ?? hit.url;
      if (seen.has(key)) continue;
      const host = hostnameOf(hit.url);
      if ((hostCount.get(host) ?? 0) >= cap) continue;
      seen.add(key);
      hostCount.set(host, (hostCount.get(host) ?? 0) + 1);
      picked.push(hit);
      progressed = true;
    }
    if (!progressed) cap += 1;
    if (picked.length >= hits.length) break;
    if (!progressed && cap > hits.length) break;
  }
  return picked.slice(0, limit);
}
