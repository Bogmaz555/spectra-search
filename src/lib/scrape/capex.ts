import * as cheerio from "cheerio";
import { capexDeepLink, capexInvestigateQuery } from "./capex-link.ts";
import { CHROME_UA, isPublicHttpUrl, publicFetch, SPECTRA_UA, type DnsLookup } from "./http.ts";
import { extractRegistryIds, isValidNip, normalizeKrs } from "./krs.ts";
import { canonicalUrl, dedupeHits, fuseHits, hostnameOf, type RankableHit } from "./rank.ts";
import {
  SERPAPI_ENV_KEY,
  SerpapiBudget,
  serpapiSearch,
} from "./serpapi.ts";

/** Free, keyless PL query templates for CapEx / investment discovery. */
export const CAPEX_TEMPLATES = [
  "{c} inwestycja",
  "{c} nowa hala",
  "{c} nowa linia produkcyjna",
  "{c} automatyzacja robotyzacja",
  "{c} rozbudowa zakładu",
] as const;

export interface CapexInput {
  company: string;
  urls: string[];
  krs?: string;
  nip?: string;
}

function asUrl(token: string): string {
  if (/^https?:\/\//i.test(token)) return token;
  if (
    /^[\w-]+(\.[\w-]+)+\/?\S*$/.test(token) &&
    token.includes(".") &&
    !/^\d/.test(token) &&
    /\.[a-z]{2,}(\/|$)/i.test(token)
  ) {
    return `https://${token}`;
  }
  return "";
}

/**
 * Split a company name, URLs, and optional KRS / NIP.
 * Labeled ids are recognized here; page text uses `extractRegistryIds`.
 */
export function parseCapexInput(raw: string): CapexInput {
  const labeled = extractRegistryIds(raw);
  let krs = labeled.krs;
  let nip = labeled.nip;
  const urls: string[] = [];
  const words: string[] = [];
  for (const token of raw.split(/[\s,;]+/).filter(Boolean)) {
    if (/^(?:krs|nip)$/i.test(token)) continue;
    if (/^(?:krs|nip)[:.-]?\d/i.test(token)) continue;
    const canon = canonicalUrl(asUrl(token));
    if (canon) {
      if (!urls.includes(canon)) urls.push(canon);
      continue;
    }
    if (/^\d{10}$/.test(token)) {
      if (token.startsWith("000")) {
        if (!krs) krs = normalizeKrs(token) ?? undefined;
      } else if (isValidNip(token)) {
        if (!nip) nip = token;
      } else if (!krs) {
        krs = token;
      }
      continue;
    }
    if (krs && normalizeKrs(token) === krs && /^\d{1,10}$/.test(token)) continue;
    if (nip && token.replace(/\D/g, "") === nip) continue;
    words.push(token);
  }
  return { company: words.join(" ").trim(), urls: urls.slice(0, 12), krs, nip };
}

export function capexQueries(company: string): string[] {
  if (!company) return [];
  return CAPEX_TEMPLATES.map((t) => t.replace("{c}", company));
}

/**
 * Google News RSS (free, no key). Item links are `news.google.com/rss/articles/…`
 * shells: robots.txt disallows them and the HTML is not the article. Call
 * `resolveCapexNewsHits` before crawling so the queue gets publisher URLs.
 */
export function parseGoogleNewsRss(xml: string, limit: number): RankableHit[] {
  const $ = cheerio.load(xml, { xml: true });
  const hits: RankableHit[] = [];
  $("item").each((_, el) => {
    if (hits.length >= limit) return false;
    const title = $(el).find("title").first().text().trim();
    const link = $(el).find("link").first().text().trim();
    const date = $(el).find("pubDate").first().text().trim();
    const publisher = $(el).find("source").first().text().trim();
    const canon = link ? canonicalUrl(link) : null;
    if (!title || !canon) return;
    hits.push({
      title,
      url: canon,
      snippet: [publisher, date].filter(Boolean).join(" · ") || "Google News",
      source: "google-news",
    });
  });
  return hits;
}

export async function googleNews(
  query: string,
  opts: { fetchImpl?: typeof fetch; limit?: number; timeoutMs?: number } = {},
): Promise<RankableHit[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pl&gl=PL&ceid=PL:pl`;
  const { response } = await publicFetch(url, {
    fetchImpl,
    timeoutMs: opts.timeoutMs ?? 7_000,
    headers: { "User-Agent": SPECTRA_UA, Accept: "application/rss+xml, application/xml" },
  });
  if (!response.ok) throw new Error(`Google News HTTP ${response.status}`);
  return parseGoogleNewsRss(await response.text(), opts.limit ?? 6);
}

/** True for news.google.com hosts. Those URLs are not article bodies. */
export function isGoogleNewsHost(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return host === "news.google.com";
  } catch {
    return false;
  }
}

export function isGoogleNewsArticleUrl(raw: string): boolean {
  if (!isGoogleNewsHost(raw)) return false;
  try {
    return new URL(raw).pathname.includes("/articles/");
  } catch {
    return false;
  }
}

interface NewsSignature {
  id: string;
  timestamp: string;
  signature: string;
}

/** Pull the signed article id Google embeds in the RSS article shell. */
export function parseGoogleNewsSignature(html: string): NewsSignature | null {
  const id = html.match(/data-n-a-id="([^"]+)"/)?.[1];
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  if (!id || !timestamp || !signature) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(id) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  if (!/^\d+$/.test(timestamp)) return null;
  return { id, timestamp, signature };
}

/** Publisher URL from a DotsSplashUi `garturlres` payload. */
export function parseBatchexecutePublisherUrl(body: string): string | null {
  const cleaned = body.replace(/^\)\]\}'\s*/, "");
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    return null;
  }
  const walk = (node: unknown): string | null => {
    if (typeof node === "string") {
      if (!node.includes("garturlres")) return null;
      try {
        const inner = JSON.parse(node) as unknown;
        if (Array.isArray(inner) && inner[0] === "garturlres" && typeof inner[1] === "string") {
          return inner[1];
        }
      } catch {
        return null;
      }
      return null;
    }
    if (!Array.isArray(node)) return null;
    for (const item of node) {
      const found = walk(item);
      if (found) return found;
    }
    return null;
  };
  const url = walk(data);
  if (!url || isGoogleNewsHost(url)) return null;
  return canonicalUrl(url);
}

/**
 * Turn one Google News article shell into the publisher URL.
 * No key. Falls back to null — callers must not crawl the shell.
 */
export async function resolveGoogleNewsArticle(
  articleUrl: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string | null> {
  if (!isGoogleNewsArticleUrl(articleUrl)) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 8_000);
  const page = await fetchImpl(articleUrl, {
    headers: { "User-Agent": CHROME_UA, Accept: "text/html", "Accept-Language": "pl" },
    signal,
  });
  if (!page.ok) return null;
  const sig = parseGoogleNewsSignature(await page.text());
  if (!sig) return null;
  const inner = JSON.stringify([
    "garturlreq",
    [
      [
        "X",
        "X",
        ["X", "X"],
        null,
        null,
        1,
        1,
        "PL:pl",
        null,
        1,
        null,
        null,
        null,
        null,
        null,
        0,
        1,
      ],
      "X",
      "X",
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    sig.id,
    Number(sig.timestamp),
    sig.signature,
  ]);
  const freq = JSON.stringify([[["Fbv4je", inner, null, "generic"]]]);
  const res = await fetchImpl(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
    {
      method: "POST",
      headers: {
        "User-Agent": CHROME_UA,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: `f.req=${encodeURIComponent(freq)}`,
      signal,
    },
  );
  if (!res.ok) return null;
  return parseBatchexecutePublisherUrl(await res.text());
}

/** Replace up to `limit` Google News shells with publisher URLs. Failures stay as shells. */
export async function resolveCapexNewsHits(
  hits: RankableHit[],
  opts: { fetchImpl?: typeof fetch; limit?: number; timeoutMs?: number; concurrency?: number } = {},
): Promise<RankableHit[]> {
  const limit = opts.limit ?? 8;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const head = hits.slice(0, limit);
  const tail = hits.slice(limit);
  const resolved: RankableHit[] = new Array(head.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const hit = head[index];
      if (!hit) return;
      if (!isGoogleNewsArticleUrl(hit.url)) {
        resolved[index] = hit;
        continue;
      }
      try {
        const publisher = await resolveGoogleNewsArticle(hit.url, opts);
        resolved[index] = publisher ? { ...hit, url: publisher } : hit;
      } catch {
        resolved[index] = hit;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, head.length) }, () => worker()));
  return dedupeHits([...resolved, ...tail]);
}

export interface CapexPerson {
  name: string;
  role: string;
  kind: "zarzad" | "prokurent";
}

export interface CapexRegistryInfo {
  krs?: string;
  nip?: string;
  name?: string;
  sourceUrl?: string;
  note?: string;
}

export interface CapexCard {
  company: string;
  investments: { what: string; value?: string; when?: string; location?: string; url?: string }[];
  signals: string[];
  checklist: { item: string; done: boolean }[];
  sources: { title: string; url: string }[];
  /** Zarząd i prokurenci z odpisu KRS. Model ich nie wymyśla. */
  people: CapexPerson[];
  registry?: CapexRegistryInfo;
  /** `/?mode=capex&q=...` — szansa otwiera „zbadaj firmę”. */
  investigateUrl: string;
}

export const CAPEX_CHECKLIST = [
  "Potwierdzona inwestycja (hala / linia / rozbudowa) ze źródłem",
  "Wartość lub skala (PLN / m² / liczba linii)",
  "Termin (start, zakończenie, przetarg)",
  "Lokalizacja zakładu",
  "Obszar pod automatyzację / pakowanie",
  "Osoba decyzyjna lub dział (jeśli w źródłach)",
];

/** Polish trade press. Five titles — packaging, automation, WNP, Puls, industry. */
export const CAPEX_PRESS = [
  { id: "wnp", label: "WNP", host: "wnp.pl" },
  { id: "pb", label: "Puls Biznesu", host: "pb.pl" },
  { id: "automatyka", label: "Automatyka B2B", host: "automatykab2b.pl" },
  { id: "opakowanie", label: "Opakowanie", host: "opakowanie.com.pl" },
  { id: "przemysl", label: "Magazyn Przemysłowy", host: "magazynprzemyslowy.pl" },
] as const;

export const COMPANY_SITE_PATHS = ["/aktualnosci", "/inwestycje", "/o-nas", "/kontakt"] as const;

const GENERIC_HOST_TOKENS = new Set([
  "firma",
  "spolka",
  "company",
  "group",
  "grupa",
  "zaklad",
  "zaklady",
  "polska",
  "poland",
]);

const BLOCKED_COMPANY_SUFFIXES = [
  "google.com",
  "google.pl",
  "wikipedia.org",
  "duckduckgo.com",
  "wikidata.org",
  "github.com",
  "arxiv.org",
  "stackoverflow.com",
  "ycombinator.com",
];

export function capexSiteQueries(
  company: string,
): { label: string; host: string; query: string }[] {
  const name = company.trim();
  if (!name) return [];
  return CAPEX_PRESS.map((site) => ({
    label: site.label,
    host: site.host,
    query: `site:${site.host} ${name}`,
  }));
}

export function emptyCapexCard(
  company: string,
  sources: { title: string; url: string }[] = [],
): CapexCard {
  return {
    company,
    investments: [],
    signals: [],
    checklist: CAPEX_CHECKLIST.map((item) => ({ item, done: false })),
    sources,
    people: [],
    investigateUrl: capexDeepLink(company),
  };
}

export function applyRegistryToCard(
  card: CapexCard,
  registry: {
    people: CapexPerson[];
    krs?: string;
    nip?: string;
    name?: string;
    sourceUrl?: string;
    sourceTitle?: string;
    note?: string;
  } | null,
  company: string,
): CapexCard {
  const people = (registry?.people ?? []).slice(0, 24);
  const sources = [...card.sources];
  if (registry?.sourceUrl && !sources.some((item) => item.url === registry.sourceUrl)) {
    sources.unshift({
      title: registry.sourceTitle || `KRS ${registry.krs ?? ""}`.trim(),
      url: registry.sourceUrl,
    });
  }
  const checklist = card.checklist.map((item) =>
    people.length > 0 && item.item.startsWith("Osoba decyzyjna") ? { ...item, done: true } : item,
  );
  const displayCompany = card.company || registry?.name || company;
  const linkCompany = company.trim() || displayCompany;
  return {
    ...card,
    company: displayCompany,
    people,
    checklist,
    sources,
    registry: registry
      ? {
          krs: registry.krs,
          nip: registry.nip,
          name: registry.name,
          sourceUrl: registry.sourceUrl,
          note: registry.note,
        }
      : card.registry,
    investigateUrl: capexDeepLink(capexInvestigateQuery(linkCompany, registry?.krs)),
  };
}

function foldHostToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

function blockedCompanyHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  if (
    CAPEX_PRESS.some((site) => normalized === site.host || normalized.endsWith(`.${site.host}`))
  ) {
    return true;
  }
  return BLOCKED_COMPANY_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

/** One company origin: user URL host, otherwise a result host that matches the name. */
export function companyOrigins(company: string, userUrls: string[], hitUrls: string[]): string[] {
  const tokens = company
    .split(/[^\p{L}\p{N}]+/u)
    .map(foldHostToken)
    .filter((token) => token.length >= 4 && !GENERIC_HOST_TOKENS.has(token));
  const scoreHost = (host: string, bonus: number) => {
    const flat = foldHostToken(host);
    return bonus + tokens.filter((token) => flat.includes(token)).length * 5;
  };
  const fromUser = [
    ...new Set(
      userUrls.map((url) => hostnameOf(url)).filter((host) => host && !blockedCompanyHost(host)),
    ),
  ];
  if (fromUser.length) {
    const ranked = fromUser
      .map((host) => ({ host, score: scoreHost(host, 10) }))
      .sort((a, b) => b.score - a.score);
    const matching = ranked.filter((item) => item.score > 10);
    return [`https://${(matching[0] ?? ranked[0]).host}`];
  }
  const fromHits = new Map<string, number>();
  for (const raw of hitUrls) {
    const host = hostnameOf(raw);
    if (!host || blockedCompanyHost(host)) continue;
    const score = scoreHost(host, 0);
    if (score <= 0) continue;
    fromHits.set(host, Math.max(fromHits.get(host) ?? 0, score));
  }
  const best = [...fromHits.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? [`https://${best[0]}`] : [];
}

/** Keep a probed URL only when the final response stayed on the company host, off `/`. */
export function acceptCompanyPath(origin: string, finalUrl: string): string | null {
  const originHost = hostnameOf(origin);
  if (!originHost || blockedCompanyHost(originHost)) return null;
  const canon = canonicalUrl(finalUrl);
  if (!canon) return null;
  if (hostnameOf(canon) !== originHost) return null;
  try {
    const path = new URL(canon).pathname;
    if (path === "/" || path === "") return null;
  } catch {
    return null;
  }
  return canon;
}

/** GET the four company paths. Queue only HTTP 200 that stayed on the same host. */
export async function probeCompanyPaths(
  origin: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; lookup?: DnsLookup } = {},
): Promise<string[]> {
  if (!isPublicHttpUrl(origin)) return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 4_000;
  const root = origin.replace(/\/$/, "");
  const found = await Promise.all(
    COMPANY_SITE_PATHS.map(async (path) => {
      const requested = `${root}${path}`;
      try {
        const { response, finalUrl } = await publicFetch(requested, {
          fetchImpl,
          timeoutMs,
          lookup: opts.lookup,
          headers: { "User-Agent": CHROME_UA, Accept: "text/html" },
        });
        await response.body?.cancel().catch(() => undefined);
        if (response.status !== 200) return null;
        return acceptCompanyPath(root, finalUrl);
      } catch {
        return null;
      }
    }),
  );
  const out: string[] = [];
  for (const url of found) {
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/** Direct URLs, then company paths that returned 200, then news — capped at maxPages. */
export function capexCrawlPlan(input: {
  direct: string[];
  companyPaths: string[];
  news: string[];
  maxPages: number;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    if (out.length >= input.maxPages) return;
    const key = canonicalUrl(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const url of input.direct) push(url);
  for (const url of input.companyPaths) push(url);
  for (const url of input.news) push(url);
  return out;
}

export async function searchCapexNews(
  company: string,
  opts: {
    fetchImpl?: typeof fetch;
    perQuery?: number;
    env?: Record<string, string | undefined>;
    serpapiBudget?: SerpapiBudget;
  } = {},
): Promise<{
  investment: RankableHit[];
  press: RankableHit[];
  investmentQueries: number;
  pressQueries: number;
  /** Queries whose RSS (and SerpAPI, when it was tried) threw. An empty 200 is not a failure. */
  investmentFailed: number;
  pressFailed: number;
  serpapiCalls?: number;
}> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const env = opts.env ?? process.env;
  const budget = opts.serpapiBudget;
  const apiKey = env[SERPAPI_ENV_KEY]?.trim() ?? "";
  const useSerpapi = Boolean(apiKey) && Boolean(budget);
  const perQuery = opts.perQuery ?? 4;
  const investQs = capexQueries(company);
  const pressQs = capexSiteQueries(company);
  let serpapiCalls = 0;
  /** Prefer SerpAPI google_news for the first few CapEx queries; RSS for the rest / fallback. */
  const load = async (
    query: string,
    limit: number,
    preferSerpapi: boolean,
  ): Promise<{ hits: RankableHit[]; failed: boolean }> => {
    if (preferSerpapi && useSerpapi && budget && budget.remainingCalls > 0) {
      try {
        const hits = await serpapiSearch({
          engine: "google_news",
          query,
          apiKey,
          fetchImpl,
          limit,
          gl: "pl",
          hl: "pl",
          budget,
        });
        serpapiCalls += 1;
        if (hits.length) return { hits, failed: false };
      } catch {
        /* fall through to free RSS */
      }
    }
    try {
      return { hits: await googleNews(query, { fetchImpl, limit }), failed: false };
    } catch {
      return { hits: [], failed: true };
    }
  };
  const [investGroups, pressGroups] = await Promise.all([
    Promise.all(investQs.map((query, index) => load(query, perQuery, index < 2))),
    Promise.all(pressQs.map((site, index) => load(site.query, 3, index < 1))),
  ]);
  const investFused = fuseHits(
    investGroups.map((group) => ({ source: "google-news", hits: group.hits })),
    company,
  ).slice(0, 8);
  const pressFused = fuseHits(
    pressGroups.map((group, index) => ({
      source: `press:${pressQs[index]?.host ?? index}`,
      hits: group.hits,
    })),
    company,
  ).slice(0, 6);
  const [investment, press] = await Promise.all([
    resolveCapexNewsHits(investFused, { fetchImpl, limit: investFused.length }),
    resolveCapexNewsHits(pressFused, { fetchImpl, limit: pressFused.length }),
  ]);
  return {
    investment,
    press,
    investmentQueries: investQs.length,
    pressQueries: pressQs.length,
    investmentFailed: investGroups.filter((group) => group.failed).length,
    pressFailed: pressGroups.filter((group) => group.failed).length,
    serpapiCalls,
  };
}
