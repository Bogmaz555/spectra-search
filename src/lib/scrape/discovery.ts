import * as cheerio from "cheerio";
import { LIMITS } from "./limits.ts";
import { canonicalUrl, dedupeHits, fuseHits, type RankableHit } from "./rank.ts";
import type { DiscoveryRun } from "./types.ts";
import { CHROME_UA, SPECTRA_UA } from "./http.ts";

type Env = Record<string, string | undefined>;

export interface DiscoveryContext {
  fetchImpl?: typeof fetch;
  env?: Env;
  timeoutMs?: number;
  perSource?: number;
}

interface Provider {
  id: string;
  label: string;
  envKey?: string;
  search: (query: string, ctx: Required<Pick<DiscoveryContext, "fetchImpl" | "env">> & {
    signal: AbortSignal;
    limit: number;
  }) => Promise<RankableHit[]>;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapDdg(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return uddg;
  } catch {
    /* keep original */
  }
  return href;
}

export function parseDuckDuckGoHtml(html: string, source: string, limit: number): RankableHit[] {
  const $ = cheerio.load(html);
  const hits: RankableHit[] = [];
  const push = (title: string, href: string, snippet: string) => {
    const url = unwrapDdg(href);
    if (!title || !url.startsWith("http")) return;
    try {
      if (new URL(url).hostname.toLowerCase().includes("duckduckgo.com")) return;
    } catch {
      return;
    }
    const canon = canonicalUrl(url);
    if (!canon) return;
    hits.push({
      title: stripTags(title),
      url: canon,
      snippet: stripTags(snippet).slice(0, 280),
      source,
    });
  };

  $(".result, .web-result, .results_links").each((_, el) => {
    if (hits.length >= limit) return false;
    const $el = $(el);
    const a = $el.find("a.result__a, a.result-link, h2 a, .result__title a").first();
    push(a.text(), a.attr("href") || "", $el.find(".result__snippet, .result-snippet").first().text());
  });

  if (!hits.length) {
    $("a.result-link").each((_, el) => {
      if (hits.length >= limit) return false;
      const a = $(el);
      const snippet = a.closest("tr").next("tr").find(".result-snippet").text() || a.parent().next().text();
      push(a.text(), a.attr("href") || "", snippet);
    });
  }

  if (!hits.length && looksLikeChallenge(html)) {
    throw new Error("Wyszukiwarka zwróciła stronę blokady");
  }
  return dedupeHits(hits).slice(0, limit);
}

function looksLikeChallenge(html: string): boolean {
  return /captcha|anomaly|unfortunately, bots/i.test(html.slice(0, 4000));
}

async function getText(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetchImpl(url, { headers, signal, redirect: "follow" });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return text;
}

const providers: Provider[] = [
  {
    id: "duckduckgo",
    label: "DuckDuckGo HTML",
    async search(query, ctx) {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const html = await getText(
        url,
        { "User-Agent": CHROME_UA, Accept: "text/html" },
        ctx.fetchImpl,
        ctx.signal,
      );
      return parseDuckDuckGoHtml(html, "duckduckgo", ctx.limit);
    },
  },
  {
    id: "duckduckgo-lite",
    label: "DuckDuckGo Lite",
    async search(query, ctx) {
      const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
      const html = await getText(
        url,
        { "User-Agent": CHROME_UA, Accept: "text/html" },
        ctx.fetchImpl,
        ctx.signal,
      );
      return parseDuckDuckGoHtml(html, "duckduckgo-lite", ctx.limit);
    },
  },
  wiki("pl", "Wikipedia PL"),
  wiki("en", "Wikipedia EN"),
  wiki("de", "Wikipedia DE"),
  {
    id: "wikidata",
    label: "Wikidata",
    async search(query, ctx) {
      const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=pl&uselang=pl&type=item&limit=${ctx.limit}&format=json&origin=*`;
      const json = JSON.parse(
        await getText(url, { "User-Agent": SPECTRA_UA, Accept: "application/json" }, ctx.fetchImpl, ctx.signal),
      ) as { search?: { label?: string; description?: string; concepturi?: string; url?: string }[] };
      const hits: RankableHit[] = [];
      for (const item of json.search ?? []) {
        const href = item.concepturi || item.url;
        if (!href || !item.label) continue;
        const canon = canonicalUrl(href);
        if (!canon) continue;
        hits.push({
          title: item.label,
          url: canon,
          snippet: item.description || "Wikidata",
          source: "wikidata",
        });
      }
      return hits;
    },
  },
  {
    id: "hackernews",
    label: "Hacker News",
    async search(query, ctx) {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${ctx.limit}`;
      const json = JSON.parse(
        await getText(url, { "User-Agent": SPECTRA_UA, Accept: "application/json" }, ctx.fetchImpl, ctx.signal),
      ) as { hits?: { title?: string; url?: string; story_text?: string; objectID?: string }[] };
      const hits: RankableHit[] = [];
      for (const item of json.hits ?? []) {
        const href = item.url || (item.objectID ? `https://news.ycombinator.com/item?id=${item.objectID}` : "");
        const canon = href ? canonicalUrl(href) : null;
        if (!canon || !item.title) continue;
        hits.push({
          title: item.title,
          url: canon,
          snippet: stripTags(item.story_text || "Hacker News"),
          source: "hackernews",
        });
      }
      return hits;
    },
  },
  {
    id: "stackoverflow",
    label: "Stack Overflow",
    async search(query, ctx) {
      const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${ctx.limit}`;
      const json = JSON.parse(
        await getText(url, { "User-Agent": SPECTRA_UA, Accept: "application/json" }, ctx.fetchImpl, ctx.signal),
      ) as { items?: { title?: string; link?: string; excerpt?: string }[] };
      const hits: RankableHit[] = [];
      for (const item of json.items ?? []) {
        const canon = item.link ? canonicalUrl(item.link) : null;
        if (!canon || !item.title) continue;
        hits.push({
          title: stripTags(item.title),
          url: canon,
          snippet: stripTags(item.excerpt || "Stack Overflow").slice(0, 280),
          source: "stackoverflow",
        });
      }
      return hits;
    },
  },
  {
    id: "arxiv",
    label: "arXiv",
    async search(query, ctx) {
      const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${ctx.limit}`;
      const xml = await getText(
        url,
        { "User-Agent": SPECTRA_UA, Accept: "application/atom+xml" },
        ctx.fetchImpl,
        ctx.signal,
      );
      return parseArxiv(xml, ctx.limit);
    },
  },
  {
    id: "github",
    label: "GitHub",
    async search(query, ctx) {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${ctx.limit}&sort=stars`;
      const json = JSON.parse(
        await getText(
          url,
          {
            "User-Agent": SPECTRA_UA,
            Accept: "application/vnd.github+json",
          },
          ctx.fetchImpl,
          ctx.signal,
        ),
      ) as { items?: { full_name?: string; html_url?: string; description?: string }[] };
      const hits: RankableHit[] = [];
      for (const item of json.items ?? []) {
        const canon = item.html_url ? canonicalUrl(item.html_url) : null;
        if (!canon || !item.full_name) continue;
        hits.push({
          title: item.full_name,
          url: canon,
          snippet: item.description || "Repozytorium GitHub",
          source: "github",
        });
      }
      return hits;
    },
  },
  {
    id: "brave",
    label: "Brave Search",
    envKey: "BRAVE_SEARCH_API_KEY",
    async search(query, ctx) {
      const key = ctx.env.BRAVE_SEARCH_API_KEY?.trim();
      if (!key) return [];
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${ctx.limit}`;
      const json = JSON.parse(
        await getText(
          url,
          {
            Accept: "application/json",
            "X-Subscription-Token": key,
          },
          ctx.fetchImpl,
          ctx.signal,
        ),
      ) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
      const hits: RankableHit[] = [];
      for (const item of json.web?.results ?? []) {
        const canon = item.url ? canonicalUrl(item.url) : null;
        if (!canon || !item.title) continue;
        hits.push({
          title: item.title,
          url: canon,
          snippet: item.description || "",
          source: "brave",
        });
      }
      return hits;
    },
  },
  {
    id: "serper",
    label: "Serper",
    envKey: "SERPER_API_KEY",
    async search(query, ctx) {
      const key = ctx.env.SERPER_API_KEY?.trim();
      if (!key) return [];
      const res = await ctx.fetchImpl("https://google.serper.dev/search", {
        method: "POST",
        signal: ctx.signal,
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": key,
        },
        body: JSON.stringify({ q: query, num: ctx.limit }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(text) as {
        organic?: { title?: string; link?: string; snippet?: string }[];
      };
      const hits: RankableHit[] = [];
      for (const item of json.organic ?? []) {
        const canon = item.link ? canonicalUrl(item.link) : null;
        if (!canon || !item.title) continue;
        hits.push({
          title: item.title,
          url: canon,
          snippet: item.snippet || "",
          source: "serper",
        });
      }
      return hits;
    },
  },
];

function wiki(lang: string, label: string): Provider {
  return {
    id: `wikipedia-${lang}`,
    label,
    async search(query, ctx) {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${ctx.limit}&utf8=1&format=json&origin=*`;
      const json = JSON.parse(
        await getText(url, { "User-Agent": SPECTRA_UA, Accept: "application/json" }, ctx.fetchImpl, ctx.signal),
      ) as { query?: { search?: { title?: string; snippet?: string }[] } };
      const hits: RankableHit[] = [];
      for (const item of json.query?.search ?? []) {
        if (!item.title) continue;
        const href = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`;
        const canon = canonicalUrl(href);
        if (!canon) continue;
        hits.push({
          title: item.title,
          url: canon,
          snippet: stripTags(item.snippet || "Wikipedia"),
          source: `wikipedia-${lang}`,
        });
      }
      return hits;
    },
  };
}

export function parseArxiv(xml: string, limit: number): RankableHit[] {
  const $ = cheerio.load(xml, { xml: true });
  const hits: RankableHit[] = [];
  $("entry").each((_, el) => {
    if (hits.length >= limit) return false;
    const title = $(el).find("title").first().text().replace(/\s+/g, " ").trim();
    const id = $(el).find("id").first().text().trim();
    const summary = $(el).find("summary").first().text().replace(/\s+/g, " ").trim();
    const canon = canonicalUrl(id);
    if (!canon || !title) return;
    hits.push({ title, url: canon, snippet: summary.slice(0, 280), source: "arxiv" });
  });
  return hits;
}

export async function runDiscovery(
  query: string,
  opts: DiscoveryContext = {},
): Promise<{ hits: RankableHit[]; runs: DiscoveryRun[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const env = opts.env ?? process.env;
  const timeoutMs = opts.timeoutMs ?? LIMITS.discoveryTimeoutMs;
  const limit = opts.perSource ?? LIMITS.discoveryPerSource;
  const runs: DiscoveryRun[] = [];
  const groups: { source: string; hits: RankableHit[] }[] = [];

  await Promise.all(
    providers.map(async (provider) => {
      const t0 = Date.now();
      if (provider.envKey && !env[provider.envKey]?.trim()) {
        runs.push({
          id: provider.id,
          label: provider.label,
          status: "skipped",
          hits: 0,
          durationMs: 0,
          message: `Pominięto — brak ${provider.envKey}`,
        });
        return;
      }
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const hits = await provider.search(query, { fetchImpl, env, signal, limit });
        groups.push({ source: provider.id, hits });
        runs.push({
          id: provider.id,
          label: provider.label,
          status: "live",
          hits: hits.length,
          durationMs: Date.now() - t0,
          message: hits.length ? `${hits.length} trafień` : "Brak trafień",
        });
      } catch (err) {
        runs.push({
          id: provider.id,
          label: provider.label,
          status: "error",
          hits: 0,
          durationMs: Date.now() - t0,
          message: err instanceof Error ? err.message.slice(0, 180) : "Błąd źródła",
        });
      }
    }),
  );

  runs.sort((a, b) => a.label.localeCompare(b.label, "pl"));
  const hits = fuseHits(groups, query).slice(0, LIMITS.fusedHitsCap);
  return { hits, runs };
}

export const DISCOVERY_PROVIDER_IDS = providers.map((p) => p.id);
