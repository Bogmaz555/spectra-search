import * as cheerio from "cheerio";
import { canonicalUrl, dedupeHits, type RankableHit } from "./rank.ts";
import { CHROME_UA, SPECTRA_UA } from "./http.ts";

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
}

/** Split "Firma X" or a list of URLs (newline/comma/space separated) or a mix. */
export function parseCapexInput(raw: string): CapexInput {
  const urls: string[] = [];
  const words: string[] = [];
  for (const token of raw.split(/[\s,;]+/).filter(Boolean)) {
    const candidate = /^https?:\/\//i.test(token) ? token : /^[\w-]+(\.[\w-]+)+\/?\S*$/.test(token) && token.includes(".") && !/^\d/.test(token) && /\.[a-z]{2,}(\/|$)/i.test(token) ? `https://${token}` : "";
    const canon = candidate ? canonicalUrl(candidate) : null;
    if (canon) {
      if (!urls.includes(canon)) urls.push(canon);
    } else {
      words.push(token);
    }
  }
  return { company: words.join(" ").trim(), urls: urls.slice(0, 12) };
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
  const res = await fetchImpl(url, {
    headers: { "User-Agent": SPECTRA_UA, Accept: "application/rss+xml, application/xml" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 7_000),
  });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  return parseGoogleNewsRss(await res.text(), opts.limit ?? 6);
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
      ["X", "X", ["X", "X"], null, null, 1, 1, "PL:pl", null, 1, null, null, null, null, null, 0, 1],
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
  const res = await fetchImpl("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
    method: "POST",
    headers: {
      "User-Agent": CHROME_UA,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: `f.req=${encodeURIComponent(freq)}`,
    signal,
  });
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

export interface CapexCard {
  company: string;
  investments: { what: string; value?: string; when?: string; location?: string; url?: string }[];
  signals: string[];
  checklist: { item: string; done: boolean }[];
  sources: { title: string; url: string }[];
}

export const CAPEX_CHECKLIST = [
  "Potwierdzona inwestycja (hala / linia / rozbudowa) ze źródłem",
  "Wartość lub skala (PLN / m² / liczba linii)",
  "Termin (start, zakończenie, przetarg)",
  "Lokalizacja zakładu",
  "Obszar pod automatyzację / pakowanie",
  "Osoba decyzyjna lub dział (jeśli w źródłach)",
];
