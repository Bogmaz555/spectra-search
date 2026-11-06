import { ENGINE_MAP, type EngineId } from "../engines.ts";
import { LIMITS } from "./limits.ts";
import { redactSecrets } from "./redact.ts";
import type { EngineRun, EngineStatus, ExtractedLink, StructuredField } from "./types.ts";

export interface AdapterPosture {
  status: Extract<EngineStatus, "live" | "degraded" | "skipped" | "not_applicable">;
  message: string;
  envKeys: string[];
}

type Env = Record<string, string | undefined>;

export function envHas(env: Env, key: string): boolean {
  return Boolean(env[key]?.trim());
}

export function adapterPosture(id: EngineId, env: Env = process.env): AdapterPosture {
  const eng = ENGINE_MAP[id];
  const envKeys = eng.envKeys ?? [];
  const keySet = envKeys.some((key) => envHas(env, key));

  if (eng.runtime === "unavailable") {
    return { status: "not_applicable", message: eng.runtimeNote, envKeys };
  }
  if (eng.runtime === "optional") {
    if (!keySet) return { status: "skipped", message: eng.runtimeNote, envKeys };
    return {
      status: "live",
      message: `${eng.name}: klucz ustawiony — wołane jest prawdziwe API (${envKeys.filter((k) => envHas(env, k)).join(", ")}).`,
      envKeys,
    };
  }
  if (id === "crawl4ai" && keySet) {
    return {
      status: "live",
      message:
        "Crawl4AI: ustawiono CRAWL4AI_API_KEY albo CRAWL4AI_BASE_URL — markdown pochodzi z tego API, nie z lokalnego konwertera.",
      envKeys,
    };
  }
  return { status: "degraded", message: eng.runtimeNote, envKeys };
}

export function adapterPostures(env: Env = process.env): Record<EngineId, AdapterPosture> {
  return Object.fromEntries(
    (Object.keys(ENGINE_MAP) as EngineId[]).map((id) => [id, adapterPosture(id, env)]),
  ) as Record<EngineId, AdapterPosture>;
}

export function mkRun(
  id: EngineId,
  status: EngineStatus,
  durationMs: number,
  message: string,
  itemsFound?: number,
): EngineRun {
  return { id, status, durationMs, message, itemsFound };
}

export interface FirecrawlPage {
  markdown: string;
  html: string;
  links: string[];
  title: string;
  description: string;
  sourceUrl: string;
  statusCode: number;
  fields: StructuredField[];
}

export function parseFirecrawlPayload(payload: unknown): FirecrawlPage | { error: string } {
  if (!payload || typeof payload !== "object") return { error: "Pusta odpowiedź Firecrawl" };
  const root = payload as Record<string, unknown>;
  if (root.success === false) {
    return { error: String(root.error || "Firecrawl odrzucił żądanie") };
  }
  const data = (root.data && typeof root.data === "object" ? root.data : root) as Record<
    string,
    unknown
  >;
  if (typeof data.error === "string" && !data.markdown && !data.html) {
    return { error: data.error };
  }
  const markdown = typeof data.markdown === "string" ? data.markdown : "";
  const html = typeof data.html === "string" ? data.html : typeof data.rawHtml === "string" ? data.rawHtml : "";
  const links = Array.isArray(data.links)
    ? data.links
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "url" in item) return String((item as { url: unknown }).url);
          return "";
        })
        .filter((href) => href.startsWith("http"))
    : [];
  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};
  const title = String(metadata.title || metadata.ogTitle || "Bez tytułu");
  const description = String(metadata.description || metadata.ogDescription || "");
  const sourceUrl = String(metadata.sourceURL || metadata.url || "");
  const statusCode = Number(metadata.statusCode || 200) || 200;
  const fields: StructuredField[] = [];
  const push = (key: string, value: unknown) => {
    if (value == null) return;
    const text = String(value).trim();
    if (!text || text === "[object Object]") return;
    fields.push({ key, value: text.slice(0, 500), source: "firecrawl" });
  };
  push("title", title);
  push("description", description);
  push("sourceURL", sourceUrl);
  push("language", metadata.language);
  push("statusCode", metadata.statusCode);
  for (const [key, value] of Object.entries(metadata)) {
    if (fields.length >= 24) break;
    if (["title", "description", "sourceURL", "language", "statusCode"].includes(key)) continue;
    if (typeof value === "string" || typeof value === "number") push(`meta.${key}`, value);
  }
  if (!markdown && !html && links.length === 0) {
    return { error: "Firecrawl nie zwrócił treści" };
  }
  return { markdown, html, links, title, description, sourceUrl, statusCode, fields };
}

export async function callFirecrawl(
  url: string,
  opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<FirecrawlPage | { error: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? LIMITS.firecrawlTimeoutMs;
  const t0 = Date.now();
  try {
    const res = await fetchImpl("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html", "links"],
        onlyMainContent: true,
        timeout: timeoutMs,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { error: `Firecrawl HTTP ${res.status}: ${redactSecrets(text).slice(0, 180)}` };
    }
    return parseFirecrawlPayload(JSON.parse(text) as unknown);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Firecrawl niedostępny";
    return { error: `${message} (${Date.now() - t0} ms)` };
  }
}

export interface BrowserUsePage {
  statusCode: number;
  body: string;
  finalUrl: string;
  contentType: string;
}

export function parseBrowserUsePayload(payload: unknown, fallbackUrl: string): BrowserUsePage | { error: string } {
  if (!payload || typeof payload !== "object") return { error: "Pusta odpowiedź Browser Use" };
  const data = payload as Record<string, unknown>;
  if (typeof data.error === "string" && data.error) return { error: data.error };
  const body = typeof data.body === "string" ? data.body : "";
  if (!body) return { error: "Browser Use nie zwrócił treści" };
  return {
    statusCode: Number(data.status_code || 0) || 0,
    body,
    finalUrl: typeof data.final_url === "string" && data.final_url ? data.final_url : fallbackUrl,
    contentType: typeof data.content_type === "string" ? data.content_type : "text/html",
  };
}

export async function callBrowserUse(
  url: string,
  opts: {
    apiKey: string;
    sessionId: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    serviceUrl?: string;
  },
): Promise<BrowserUsePage | { error: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? LIMITS.browserUseTimeoutMs;
  const base = (opts.serviceUrl || "https://fetch.browser-use.com").replace(/\/$/, "");
  try {
    const res = await fetchImpl(`${base}/fetch`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs + 2_000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Browser-Use-API-Key": opts.apiKey,
      },
      body: JSON.stringify({
        url,
        method: "GET",
        timeout_ms: timeoutMs,
        follow_redirects: true,
        max_redirects: 5,
        proxy_country: "PL",
        session_id: opts.sessionId,
        output_format: "simplified",
      }),
    });
    const text = await res.text();
    if (!res.ok) return { error: `Browser Use HTTP ${res.status}: ${redactSecrets(text).slice(0, 180)}` };
    return parseBrowserUsePayload(JSON.parse(text) as unknown, url);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Browser Use niedostępny" };
  }
}

export function parseCrawl4aiPayload(payload: unknown): { markdown: string } | { error: string } {
  if (!payload || typeof payload !== "object") return { error: "Pusta odpowiedź Crawl4AI" };
  const root = payload as Record<string, unknown>;
  if (root.success === false) return { error: String(root.error || "Crawl4AI odrzucił żądanie") };
  const nested =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root.result && typeof root.result === "object"
        ? (root.result as Record<string, unknown>)
        : root;
  const markdown =
    typeof nested.markdown === "string"
      ? nested.markdown
      : typeof root.markdown === "string"
        ? root.markdown
        : typeof nested.md === "string"
          ? nested.md
          : "";
  if (!markdown.trim()) return { error: "Crawl4AI nie zwrócił markdown" };
  return { markdown };
}

export async function callCrawl4ai(
  url: string,
  opts: {
    env: Env;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<{ markdown: string } | { error: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? LIMITS.crawl4aiTimeoutMs;
  const base = opts.env.CRAWL4AI_BASE_URL?.trim().replace(/\/$/, "");
  const cloudKey = opts.env.CRAWL4AI_API_KEY?.trim();
  const token = opts.env.CRAWL4AI_API_TOKEN?.trim();
  let endpoint = "";
  let headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  let body: Record<string, unknown> = { url };

  if (base) {
    endpoint = `${base}/md`;
    body = { url, f: "fit" };
    if (token) headers.Authorization = `Bearer ${token}`;
  } else if (cloudKey) {
    endpoint = "https://api.crawl4ai.com/scrape";
    headers.Authorization = `Bearer ${cloudKey}`;
    body = { url, format: "md" };
  } else {
    return { error: "Brak CRAWL4AI_API_KEY i CRAWL4AI_BASE_URL" };
  }

  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) return { error: `Crawl4AI HTTP ${res.status}: ${redactSecrets(text).slice(0, 180)}` };
    return parseCrawl4aiPayload(JSON.parse(text) as unknown);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Crawl4AI niedostępny" };
  }
}

export function firecrawlLinks(links: string[], pageUrl: string): ExtractedLink[] {
  let host = "";
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const seen = new Set<string>();
  const out: ExtractedLink[] = [];
  for (const href of links) {
    if (seen.has(href)) continue;
    seen.add(href);
    let external = true;
    try {
      external = new URL(href).hostname.replace(/^www\./, "") !== host;
    } catch {
      continue;
    }
    out.push({ href, text: href, external });
    if (out.length >= 80) break;
  }
  return out;
}
