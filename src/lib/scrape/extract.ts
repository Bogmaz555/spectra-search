import * as cheerio from "cheerio";
import type {
  ExtractedLink,
  ExtractedMedia,
  InteractiveElement,
  MobileInsight,
  PatternGroup,
  StructuredField,
} from "./types.ts";

export function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function absoluteUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

export function htmlToMarkdown(html: string, baseUrl: string): string {
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

/** Local cleanup inspired by the role of MarkItDown. This is not Microsoft MarkItDown. */
export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\[([^\]]{0,2})\]\([^)]+\)/g, "$1")
    .trim();
}

export function extractDocument(html: string, baseUrl: string): {
  title: string;
  description: string;
  structured: StructuredField[];
  links: ExtractedLink[];
  media: ExtractedMedia[];
  patterns: PatternGroup[];
  interactive: InteractiveElement[];
  mobile: MobileInsight;
  textPreview: string;
} {
  const $ = cheerio.load(html);
  const title =
    cleanText($("meta[property='og:title']").attr("content") || "") ||
    cleanText($("title").first().text()) ||
    cleanText($("h1").first().text()) ||
    "Bez tytułu";

  const description =
    cleanText($("meta[property='og:description']").attr("content") || "") ||
    cleanText($("meta[name='description']").attr("content") || "") ||
    cleanText($("p").first().text()).slice(0, 280);

  const structured: StructuredField[] = [];
  const push = (key: string, value: string | undefined) => {
    if (value && cleanText(value)) {
      structured.push({ key, value: cleanText(value), source: "spectra" });
    }
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
      }
    } catch {
      /* invalid JSON-LD */
    }
  });

  $("h1, h2").each((i, el) => {
    if (i >= 8) return false;
    const t = cleanText($(el).text());
    if (t) structured.push({ key: `heading.${i + 1}`, value: t, source: "spectra" });
  });

  const links = extractLinks($, baseUrl);
  const media = extractMedia($, baseUrl);
  const patterns = extractPatterns($);
  const interactive = extractInteractive($);
  const mobile = extractMobile($);
  const textPreview = cleanText($.root().text()).slice(0, 600);

  return {
    title,
    description,
    structured,
    links,
    media,
    patterns,
    interactive,
    mobile,
    textPreview,
  };
}

function extractLinks($: cheerio.CheerioAPI, baseUrl: string): ExtractedLink[] {
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];
  let baseHost = "";
  try {
    baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
  } catch {
    /* */
  }

  $("a[href]").each((_, el) => {
    if (links.length >= 80) return false;
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      return;
    }
    const abs = absoluteUrl(baseUrl, href);
    if (!abs || seen.has(abs)) return;
    if (!/^https?:/i.test(abs)) return;
    seen.add(abs);
    let external = false;
    try {
      external = new URL(abs).hostname.replace(/^www\./, "") !== baseHost;
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
    if (media.length >= 24) return false;
    push("image", $(el).attr("src") || $(el).attr("data-src"), $(el).attr("alt"));
  });
  $("video[src], video source[src]").each((_, el) => {
    if (media.length >= 24) return false;
    push("video", $(el).attr("src"));
  });
  $("link[rel='icon'], link[rel='apple-touch-icon']").each((_, el) => {
    push("icon", $(el).attr("href"));
  });
  return media;
}

function extractInteractive($: cheerio.CheerioAPI): InteractiveElement[] {
  const items: InteractiveElement[] = [];
  $("a, button, input, select, textarea, [role='button']").each((_, el) => {
    if (items.length >= 40) return false;
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "el";
    const $el = $(el);
    items.push({
      tag,
      type: $el.attr("type"),
      name: $el.attr("name") || $el.attr("id") || $el.attr("aria-label"),
      text:
        truncate(cleanText($el.text() || $el.attr("value") || $el.attr("placeholder") || ""), 80) ||
        undefined,
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

export function visibleTextLength(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

export function linksFromMarkdown(markdown: string, baseUrl: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  let baseHost = "";
  try {
    baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
  } catch {
    /* */
  }
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of markdown.matchAll(re)) {
    const href = match[2];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    let external = true;
    try {
      external = new URL(href).hostname.replace(/^www\./, "") !== baseHost;
    } catch {
      external = true;
    }
    links.push({ href, text: truncate(match[1] || href, 120), external });
    if (links.length >= 40) break;
  }
  return links;
}
