import * as cheerio from "cheerio";
import { canonicalUrl, type RankableHit } from "./rank.ts";
import { SPECTRA_UA } from "./http.ts";

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

/** Google News RSS (free, no key). Links are news.google.com redirects; we keep them as-is. */
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
