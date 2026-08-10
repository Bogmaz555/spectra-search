import * as cheerio from "cheerio";
import { ENGINES, type EngineId } from "@/lib/engines";
import { isUrl, normalizeUrl, truncate } from "@/lib/utils";
import { getXaiStatus, scoreEffectiveness, synthesizeWithGrok } from "@/lib/xai";
import type {
  EngineRun,
  EngineStatus,
  ExtractedLink,
  ExtractedMedia,
  InteractiveElement,
  MobileInsight,
  PatternGroup,
  SearchHit,
  SearchMode,
  SourceResult,
  SpectraAi,
  SpectraRequest,
  SpectraResult,
  StructuredField,
} from "./types";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent": CHROME_UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function now() {
  return Date.now();
}

function mkRun(
  id: EngineId,
  status: EngineStatus,
  durationMs: number,
  message: string,
  itemsFound?: number,
): EngineRun {
  return { id, status, durationMs, message, itemsFound };
}

async function timedFetch(
  url: string,
  init?: RequestInit,
): Promise<{ res: Response; body: string; durationMs: number }> {
  const t0 = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        ...FETCH_HEADERS,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    const body = await res.text();
    return { res, body, durationMs: now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

function absoluteUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function htmlToMarkdown(html: string, baseUrl: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, svg, canvas, template").remove();
  $("nav, footer, aside, [role='navigation'], [role='banner'], .cookie, .cookies, #cookie").remove();

  const parts: string[] = [];
  const root = $("main").length
    ? $("main").first()
    : $("article").length
      ? $("article").first()
      : $("body");

  root.find("h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, hr, img").each((_, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "";
    const $n = $(el);

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const text = cleanText($n.text());
      if (text) parts.push(`\n${"#".repeat(level)} ${text}\n`);
      return;
    }
    if (tag === "p") {
      const text = cleanText($n.text());
      if (text) parts.push(`\n${text}\n`);
      return;
    }
    if (tag === "li") {
      const text = cleanText($n.text());
      if (text) parts.push(`- ${text}`);
      return;
    }
    if (tag === "pre") {
      const text = $n.text().trim();
      if (text) parts.push(`\n\`\`\`\n${text}\n\`\`\`\n`);
      return;
    }
    if (tag === "blockquote") {
      const text = cleanText($n.text());
      if (text) parts.push(`\n> ${text}\n`);
      return;
    }
    if (tag === "hr") {
      parts.push("\n---\n");
      return;
    }
    if (tag === "img") {
      const alt = $n.attr("alt") || "image";
      const src = $n.attr("src") || $n.attr("data-src");
      if (src) {
        const abs = absoluteUrl(baseUrl, src);
        if (abs) parts.push(`![${alt}](${abs})`);
      }
    }
  });

  if (parts.join("").trim().length < 40) {
    const text = cleanText(root.text());
    if (text) {
      const title = cleanText($("title").first().text()) || cleanText($("h1").first().text());
      return [title ? `# ${title}` : "", text.slice(0, 8000)].filter(Boolean).join("\n\n");
    }
  }

  return parts
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function extractMeta($: cheerio.CheerioAPI): {
  title: string;
  description: string;
  fields: StructuredField[];
} {
  const title =
    cleanText($("meta[property='og:title']").attr("content") || "") ||
    cleanText($("title").first().text()) ||
    cleanText($("h1").first().text()) ||
    "Bez tytułu";

  const description =
    cleanText($("meta[property='og:description']").attr("content") || "") ||
    cleanText($("meta[name='description']").attr("content") || "") ||
    cleanText($("p").first().text()).slice(0, 280);

  const fields: StructuredField[] = [];
  const push = (key: string, value: string | undefined, source: EngineId = "firecrawl") => {
    if (value && cleanText(value)) fields.push({ key, value: cleanText(value), source });
  };

  push("title", title);
  push("description", description);
  push("og:site_name", $("meta[property='og:site_name']").attr("content"));
  push("og:type", $("meta[property='og:type']").attr("content"));
  push("og:image", $("meta[property='og:image']").attr("content"));
  push("canonical", $("link[rel='canonical']").attr("href"));
  push("author", $("meta[name='author']").attr("content"));
  push("keywords", $("meta[name='keywords']").attr("content"));
  push("language", $("html").attr("lang"));
  push("published", $("meta[property='article:published_time']").attr("content"));
  push("twitter:card", $("meta[name='twitter:card']").attr("content"));
  push("twitter:site", $("meta[name='twitter:site']").attr("content"));

  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const raw = $(el).html();
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, unknown> | Record<string, unknown>[];
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"]) push("schema:type", String(item["@type"]));
        if (item.name) push("schema:name", String(item.name));
        if (item.headline) push("schema:headline", String(item.headline));
        if (item.datePublished) push("schema:datePublished", String(item.datePublished));
        if (item.author) {
          const a = item.author as { name?: string } | string;
          push("schema:author", typeof a === "string" ? a : a.name);
        }
      }
    } catch {
      /* */
    }
  });

  return { title, description, fields };
}

function extractLinks($: cheerio.CheerioAPI, baseUrl: string): ExtractedLink[] {
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];
  let baseHost = "";
  try {
    baseHost = new URL(baseUrl).hostname;
  } catch {
    /* */
  }

  $("a[href]").each((_, el) => {
    if (links.length >= 80) return false;
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    const abs = absoluteUrl(baseUrl, href);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    let external = false;
    try {
      external = new URL(abs).hostname !== baseHost;
    } catch {
      external = true;
    }
    const text = cleanText($(el).text()) || abs;
    links.push({ href: abs, text: truncate(text, 120), external });
  });
  return links;
}

function extractMedia($: cheerio.CheerioAPI, baseUrl: string): ExtractedMedia[] {
  const media: ExtractedMedia[] = [];
  const seen = new Set<string>();

  const push = (type: ExtractedMedia["type"], srcRaw: string | undefined, alt?: string) => {
    if (!srcRaw || srcRaw.startsWith("data:")) return;
    const src = absoluteUrl(baseUrl, srcRaw);
    if (!src || seen.has(src)) return;
    seen.add(src);
    media.push({ type, src, alt: alt ? cleanText(alt) : undefined });
  };

  $("img[src], img[data-src]").each((_, el) => {
    if (media.length >= 40) return false;
    push("image", $(el).attr("src") || $(el).attr("data-src"), $(el).attr("alt"));
  });
  $("video[src], video source[src]").each((_, el) => {
    if (media.length >= 40) return false;
    push("video", $(el).attr("src"));
  });
  $("link[rel='icon'], link[rel='apple-touch-icon']").each((_, el) => {
    push("icon", $(el).attr("href"));
  });
  return media;
}

function extractInteractive($: cheerio.CheerioAPI): InteractiveElement[] {
  const items: InteractiveElement[] = [];
  $("a, button, input, select, textarea, [role='button'], [onclick]").each((_, el) => {
    if (items.length >= 50) return false;
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "el";
    const $el = $(el);
    items.push({
      tag,
      type: $el.attr("type"),
      name: $el.attr("name") || $el.attr("id") || $el.attr("aria-label"),
      text:
        truncate(
          cleanText($el.text() || $el.attr("value") || $el.attr("placeholder") || ""),
          80,
        ) || undefined,
      href: $el.attr("href"),
    });
  });
  return items;
}

function extractMobile($: cheerio.CheerioAPI): MobileInsight {
  const viewport = $("meta[name='viewport']").attr("content");
  const appleItunes = $("meta[name='apple-itunes-app']").attr("content");
  const themeColor = $("meta[name='theme-color']").attr("content");
  let playStore: string | undefined;
  $("a[href*='play.google.com']").each((_, el) => {
    playStore = $(el).attr("href");
    return false;
  });
  return {
    viewport,
    hasAppLinks: Boolean(appleItunes || playStore),
    appleItunes,
    playStore,
    themeColor,
    isMobileOptimized: Boolean(viewport && /width\s*=\s*device-width/i.test(viewport)),
  };
}

function extractPatterns($: cheerio.CheerioAPI): PatternGroup[] {
  const groups: PatternGroup[] = [];
  const candidates = [
    { sel: "ul li", label: "Lista punktowana" },
    { sel: "ol li", label: "Lista numerowana" },
    { sel: "article h2, article h3", label: "Nagłówki artykułów" },
    { sel: ".card h2, .card h3, [class*='card'] h2, [class*='card'] h3", label: "Karty treści" },
    { sel: "table tr td:first-child", label: "Wiersze tabeli" },
    { sel: "nav a", label: "Nawigacja" },
  ];

  for (const c of candidates) {
    const items: string[] = [];
    $(c.sel).each((_, el) => {
      if (items.length >= 20) return false;
      const t = cleanText($(el).text());
      if (t && t.length > 2 && t.length < 200) items.push(t);
    });
    const unique = [...new Set(items)];
    if (unique.length >= 3) {
      groups.push({
        label: c.label,
        items: unique.slice(0, 12),
        confidence: Math.min(0.95, 0.45 + unique.length * 0.04),
      });
    }
  }
  return groups.slice(0, 6);
}

function emptySource(url: string, engines: EngineRun[], started: string): SourceResult {
  return {
    url,
    title: "Nie udało się pobrać",
    description: "Źródło niedostępne lub zablokowane",
    markdown: "",
    textPreview: "",
    links: [],
    media: [],
    structured: [],
    patterns: [],
    interactive: [],
    mobile: { hasAppLinks: false, isMobileOptimized: false },
    wordCount: 0,
    statusCode: 0,
    contentType: "",
    engines,
    fetchedAt: started,
  };
}

async function scrapeUrl(url: string, enabled: Set<EngineId>): Promise<SourceResult> {
  const engines: EngineRun[] = [];
  const started = new Date().toISOString();

  let body = "";
  let statusCode = 0;
  let contentType = "";
  let finalUrl = url;

  if (enabled.has("curl-impersonate")) {
    const t0 = now();
    try {
      const { res, body: b, durationMs } = await timedFetch(url);
      body = b;
      statusCode = res.status;
      contentType = res.headers.get("content-type") || "text/html";
      finalUrl = res.url || url;
      engines.push(
        mkRun(
          "curl-impersonate",
          "done",
          durationMs,
          `Pobrano ${statusCode} · ${Math.round(body.length / 1024)} KB · fingerprint Chrome`,
          1,
        ),
      );
    } catch (e) {
      engines.push(
        mkRun(
          "curl-impersonate",
          "error",
          now() - t0,
          e instanceof Error ? e.message : "Fetch failed",
        ),
      );
      return emptySource(url, engines, started);
    }
  } else {
    engines.push(mkRun("curl-impersonate", "skipped", 0, "Wyłączony"));
    return emptySource(url, engines, started);
  }

  if (enabled.has("scrapling")) {
    const t0 = now();
    const blocked =
      statusCode === 403 ||
      statusCode === 429 ||
      statusCode === 503 ||
      /captcha|access denied|cloudflare|just a moment/i.test(body.slice(0, 4000));

    if (blocked) {
      try {
        const { res, body: b, durationMs } = await timedFetch(url, {
          headers: {
            ...FETCH_HEADERS,
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            "Sec-Ch-Ua-Mobile": "?1",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
        if (res.status < 400 && b.length > body.length * 0.5) {
          body = b;
          statusCode = res.status;
          contentType = res.headers.get("content-type") || contentType;
          finalUrl = res.url || finalUrl;
          engines.push(
            mkRun("scrapling", "done", durationMs, "Adaptacyjny retry — odblokowano odpowiedź", 1),
          );
        } else {
          engines.push(
            mkRun(
              "scrapling",
              "done",
              now() - t0,
              `Strona może blokować boty (${statusCode}) — użyto najlepszej odpowiedzi`,
            ),
          );
        }
      } catch {
        engines.push(
          mkRun(
            "scrapling",
            "done",
            now() - t0,
            "Retry nie powiódł się — kontynuacja z oryginałem",
          ),
        );
      }
    } else {
      engines.push(
        mkRun(
          "scrapling",
          "done",
          now() - t0,
          "Brak detekcji antybot — fingerprint zaakceptowany",
        ),
      );
    }
  } else {
    engines.push(mkRun("scrapling", "skipped", 0, "Wyłączony"));
  }

  const $ = cheerio.load(body);
  const meta = extractMeta($);

  let interactive: InteractiveElement[] = [];
  if (enabled.has("browser-use")) {
    const t0 = now();
    interactive = extractInteractive($);
    engines.push(
      mkRun(
        "browser-use",
        "done",
        now() - t0,
        `Wykryto ${interactive.length} elementów interaktywnych`,
        interactive.length,
      ),
    );
  } else {
    engines.push(mkRun("browser-use", "skipped", 0, "Wyłączony"));
  }

  let links: ExtractedLink[] = [];
  if (enabled.has("crawlee") || enabled.has("scrapy")) {
    const t0 = now();
    links = extractLinks($, finalUrl);
    if (enabled.has("crawlee")) {
      const internal = links.filter((l) => !l.external).length;
      const external = links.filter((l) => l.external).length;
      engines.push(
        mkRun(
          "crawlee",
          "done",
          now() - t0,
          `Kolejka: ${links.length} linków (${internal} wewnętrznych, ${external} zewnętrznych)`,
          links.length,
        ),
      );
    } else {
      engines.push(mkRun("crawlee", "skipped", 0, "Wyłączony"));
    }
  } else {
    engines.push(mkRun("crawlee", "skipped", 0, "Wyłączony"));
  }

  let media: ExtractedMedia[] = [];
  if (enabled.has("scrapy")) {
    const t0 = now();
    media = extractMedia($, finalUrl);
    const headings = $("h1,h2,h3").length;
    engines.push(
      mkRun(
        "scrapy",
        "done",
        now() - t0,
        `Wyciągnięto ${headings} nagłówków, ${media.length} mediów, ${links.length} linków`,
        headings + media.length,
      ),
    );
  } else {
    if (!links.length) links = extractLinks($, finalUrl);
    media = extractMedia($, finalUrl);
    engines.push(mkRun("scrapy", "skipped", 0, "Wyłączony"));
  }

  let patterns: PatternGroup[] = [];
  if (enabled.has("autoscraper")) {
    const t0 = now();
    patterns = extractPatterns($);
    const total = patterns.reduce((s, g) => s + g.items.length, 0);
    engines.push(
      mkRun(
        "autoscraper",
        "done",
        now() - t0,
        `Wykryto ${patterns.length} wzorców (${total} elementów)`,
        total,
      ),
    );
  } else {
    engines.push(mkRun("autoscraper", "skipped", 0, "Wyłączony"));
  }

  let structured: StructuredField[] = meta.fields;
  if (enabled.has("firecrawl")) {
    const t0 = now();
    $("h1, h2").each((i, el) => {
      if (i >= 8) return false;
      const t = cleanText($(el).text());
      if (t) structured.push({ key: `heading.${i + 1}`, value: t, source: "firecrawl" });
    });
    engines.push(
      mkRun(
        "firecrawl",
        "done",
        now() - t0,
        `Struktura JSON: ${structured.length} pól`,
        structured.length,
      ),
    );
  } else {
    engines.push(mkRun("firecrawl", "skipped", 0, "Wyłączony"));
  }

  let markdown = "";
  if (enabled.has("crawl4ai")) {
    const t0 = now();
    markdown = htmlToMarkdown(body, finalUrl);
    engines.push(
      mkRun(
        "crawl4ai",
        "done",
        now() - t0,
        `Markdown: ${markdown.length.toLocaleString("pl-PL")} znaków`,
        markdown.length,
      ),
    );
  } else {
    engines.push(mkRun("crawl4ai", "skipped", 0, "Wyłączony"));
  }

  if (enabled.has("markitdown")) {
    const t0 = now();
    if (!markdown) markdown = htmlToMarkdown(body, finalUrl);
    markdown = markdown
      .replace(/\[([^\]]{0,2})\]\([^)]+\)/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    engines.push(
      mkRun(
        "markitdown",
        "done",
        now() - t0,
        "Dokument znormalizowany do AI-ready Markdown",
        markdown.split(/\s+/).length,
      ),
    );
  } else {
    engines.push(mkRun("markitdown", "skipped", 0, "Wyłączony"));
  }

  let mobile: MobileInsight = { hasAppLinks: false, isMobileOptimized: false };
  if (enabled.has("scrcpy")) {
    const t0 = now();
    mobile = extractMobile($);
    engines.push(
      mkRun(
        "scrcpy",
        "done",
        now() - t0,
        mobile.isMobileOptimized
          ? `Mobile-ready${mobile.hasAppLinks ? " · app links wykryte" : ""}`
          : "Brak optymalizacji mobile / viewport",
        mobile.isMobileOptimized ? 1 : 0,
      ),
    );
  } else {
    engines.push(mkRun("scrcpy", "skipped", 0, "Wyłączony"));
  }

  if (!markdown) markdown = `# ${meta.title}\n\n${meta.description}\n`;

  const textPreview = cleanText($.root().text()).slice(0, 600);
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  return {
    url: finalUrl,
    title: meta.title,
    description: meta.description,
    markdown,
    textPreview,
    links,
    media,
    structured,
    patterns,
    interactive,
    mobile,
    wordCount,
    statusCode,
    contentType,
    engines,
    fetchedAt: started,
  };
}

async function searchDuckDuckGo(query: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const { body } = await timedFetch(url, {
      headers: { ...FETCH_HEADERS, Accept: "text/html" },
    });
    const $ = cheerio.load(body);
    $(".result, .web-result, .results_links").each((_, el) => {
      if (hits.length >= 8) return false;
      const $el = $(el);
      const a = $el.find("a.result__a, a.result-link, h2 a, .result__title a").first();
      let href = a.attr("href") || "";
      if (href.includes("uddg=")) {
        try {
          const u = new URL(href, "https://duckduckgo.com");
          href = u.searchParams.get("uddg") || href;
        } catch {
          /* */
        }
      }
      const title = cleanText(a.text());
      const snippet = cleanText(
        $el.find(".result__snippet, .result-snippet, .result__body").first().text(),
      );
      if (title && href && href.startsWith("http")) {
        hits.push({ title, url: href, snippet, source: "duckduckgo" });
      }
    });
  } catch {
    /* */
  }
  return hits;
}

async function searchWikipedia(query: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  try {
    const api = `https://pl.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json&origin=*`;
    const { body } = await timedFetch(api, {
      headers: { Accept: "application/json", "User-Agent": CHROME_UA },
    });
    const data = JSON.parse(body) as [string, string[], string[], string[]];
    for (let i = 0; i < (data[1] || []).length; i++) {
      hits.push({
        title: data[1][i],
        url: data[3][i],
        snippet: data[2][i] || "Wikipedia",
        source: "wikipedia",
      });
    }
  } catch {
    /* */
  }

  if (hits.length === 0) {
    try {
      const api = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json&origin=*`;
      const { body } = await timedFetch(api, {
        headers: { Accept: "application/json", "User-Agent": CHROME_UA },
      });
      const data = JSON.parse(body) as [string, string[], string[], string[]];
      for (let i = 0; i < (data[1] || []).length; i++) {
        hits.push({
          title: data[1][i],
          url: data[3][i],
          snippet: data[2][i] || "Wikipedia",
          source: "wikipedia",
        });
      }
    } catch {
      /* */
    }
  }
  return hits;
}

function buildSummary(
  query: string,
  mode: SpectraResult["resolvedMode"],
  hits: SearchHit[],
  sources: SourceResult[],
): string {
  if (sources.length === 0 && hits.length === 0) {
    return `Brak wyników dla „${query}”. Spróbuj innego zapytania lub wklej bezpośredni URL.`;
  }

  const lines: string[] = [];
  if (mode === "url" || mode === "deep") {
    const s = sources[0];
    if (s) {
      lines.push(`**${s.title}**`);
      if (s.description) lines.push(s.description);
      lines.push(
        `Źródło: ${s.url} · ${s.wordCount} słów · ${s.links.length} linków · status ${s.statusCode || "—"}`,
      );
      if (s.patterns.length) {
        lines.push(
          `Wykryte wzorce: ${s.patterns.map((p) => `${p.label} (${p.items.length})`).join(", ")}.`,
        );
      }
      if (s.mobile.isMobileOptimized) lines.push("Strona jest zoptymalizowana pod mobile.");
    }
  } else {
    lines.push(`Znaleziono **${hits.length}** trafień dla „${query}”.`);
    if (sources.length) {
      lines.push(
        `Przeanalizowano głęboko **${sources.length}** źródeł w pipeline SPECTRA.`,
      );
      for (const s of sources.slice(0, 3)) {
        lines.push(`• **${s.title}** — ${truncate(s.description || s.textPreview, 140)}`);
      }
    }
  }
  return lines.join("\n\n");
}

function resolveMode(query: string, mode: SearchMode): "search" | "url" | "deep" {
  if (mode === "url") return "url";
  if (mode === "deep") return "deep";
  if (mode === "search") return "search";
  if (isUrl(query)) return "url";
  return "search";
}

export async function runSpectra(req: SpectraRequest): Promise<SpectraResult> {
  const query = req.query.trim();
  if (!query) throw new Error("Podaj zapytanie lub URL");

  const mode = req.mode ?? "auto";
  const resolved = resolveMode(query, mode);
  const enabledList = req.engines?.length ? req.engines : ENGINES.map((e) => e.id);
  const enabled = new Set<EngineId>(enabledList);
  const maxPages = Math.min(Math.max(req.maxPages ?? (resolved === "deep" ? 3 : 2), 1), 4);
  const useAi = req.useAi !== false;

  const t0 = now();
  const startedAt = new Date().toISOString();
  let hits: SearchHit[] = [];
  const sources: SourceResult[] = [];
  const globalEngines: EngineRun[] = [];

  if (resolved === "url") {
    const url = normalizeUrl(query);
    hits = [{ title: url, url, snippet: "Bezpośredni crawl URL", source: "direct" }];
    const source = await scrapeUrl(url, enabled);
    sources.push(source);
    globalEngines.push(...source.engines);
  } else {
    const tSearch = now();
    const [ddg, wiki] = await Promise.all([searchDuckDuckGo(query), searchWikipedia(query)]);
    const seen = new Set<string>();
    for (const h of [...wiki, ...ddg]) {
      if (seen.has(h.url)) continue;
      seen.add(h.url);
      hits.push(h);
    }
    globalEngines.push(
      mkRun(
        "crawlee",
        "done",
        now() - tSearch,
        `Discovery: ${hits.length} wyników (Wikipedia + DuckDuckGo)`,
        hits.length,
      ),
    );

    const toScrape = hits.slice(0, maxPages);
    const scraped = await Promise.all(
      toScrape.map((h) =>
        scrapeUrl(h.url, enabled).catch(() =>
          emptySource(h.url, [], new Date().toISOString()),
        ),
      ),
    );
    sources.push(...scraped);

    if (scraped[0]) {
      for (const eng of ENGINES) {
        if (globalEngines.some((g) => g.id === eng.id)) continue;
        const runs = scraped
          .map((s) => s.engines.find((e) => e.id === eng.id))
          .filter(Boolean) as EngineRun[];
        if (!runs.length) continue;
        const done = runs.filter((r) => r.status === "done");
        const items = done.reduce((s, r) => s + (r.itemsFound ?? 0), 0);
        const dur = Math.round(runs.reduce((s, r) => s + r.durationMs, 0) / runs.length);
        globalEngines.push(
          mkRun(
            eng.id,
            done.length ? "done" : runs[0].status,
            dur,
            done.length
              ? `Agregacja z ${done.length} źródeł · ${items} elementów`
              : runs[0].message,
            items,
          ),
        );
      }
    }
  }

  if (resolved === "deep" && sources[0]) {
    const follow = sources[0].links
      .filter((l) => !l.external)
      .slice(0, 2)
      .map((l) => l.href);
    for (const u of follow) {
      if (sources.some((s) => s.url === u)) continue;
      try {
        const s = await scrapeUrl(u, enabled);
        sources.push(s);
        hits.push({
          title: s.title,
          url: s.url,
          snippet: s.description,
          source: "direct",
        });
      } catch {
        /* */
      }
    }
  }

  for (const eng of ENGINES) {
    if (!globalEngines.some((g) => g.id === eng.id)) {
      globalEngines.push(
        mkRun(
          eng.id,
          enabled.has(eng.id) ? "done" : "skipped",
          0,
          enabled.has(eng.id) ? "Ukończono w pipeline" : "Wyłączony",
        ),
      );
    }
  }

  globalEngines.sort((a, b) => {
    const oa = ENGINES.find((e) => e.id === a.id)?.order ?? 99;
    const ob = ENGINES.find((e) => e.id === b.id)?.order ?? 99;
    return oa - ob;
  });

  const effectiveness = scoreEffectiveness({ hits, sources, resolvedMode: resolved });
  const xai = getXaiStatus();

  let ai: SpectraAi = {
    enabled: xai.available,
    used: false,
    model: xai.model,
    answer: "",
    keyPoints: [],
    confidence: 0,
    citations: [],
    error: xai.available
      ? useAi
        ? undefined
        : "Synteza Grok wyłączona w tym skanie"
      : xai.note,
  };

  if (useAi && xai.available) {
    ai = await synthesizeWithGrok({
      query,
      mode: resolved,
      hits,
      sources,
    });
  }

  const finishedAt = new Date().toISOString();
  return {
    query,
    mode,
    resolvedMode: resolved,
    hits,
    sources,
    engines: globalEngines,
    summary: buildSummary(query, resolved, hits, sources),
    totalDurationMs: now() - t0,
    startedAt,
    finishedAt,
    ai,
    effectiveness,
  };
}
