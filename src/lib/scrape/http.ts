import { isIP } from "node:net";
import { LIMITS } from "./limits.ts";

export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const SPECTRA_UA = "SPECTRA/1.0 (multi-source search; respectful crawl)";

const CHROME_HEADERS: Record<string, string> = {
  "User-Agent": CHROME_UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Upgrade-Insecure-Requests": "1",
};

const ALT_HEADERS: Record<string, string> = {
  ...CHROME_HEADERS,
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9,pl;q=0.6",
  "Sec-Ch-Ua-Mobile": "?1",
  "Sec-Ch-Ua-Platform": '"macOS"',
};

export interface HttpResult {
  ok: boolean;
  url: string;
  statusCode: number;
  contentType: string;
  body: string;
  blocked: boolean;
  attempts: number;
  robotsBlocked: boolean;
  durationMs: number;
  error?: string;
}

export function ipIsPrivate(ip: string): boolean {
  let v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v.startsWith("::ffff:")) v = v.slice(7);
  if (v === "::1" || v === "0:0:0:0:0:0:0:1") return true;
  if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  if (!isIP(v)) return false;
  if (v.includes(":")) return false;
  const parts = v.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localdomain")) {
    return true;
  }
  if (isIP(host) && ipIsPrivate(host)) return true;
  return false;
}

/** Reject non-http(s) and obvious private/link-local targets before any fetch. */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return !isBlockedHostname(u.hostname);
}

export function looksBlocked(status: number, body: string): boolean {
  if (status === 401 || status === 403 || status === 429 || status === 503) return true;
  if (body.length > 120_000) return false;
  const head = body.slice(0, 6_000);
  return /cf-browser-verification|cf-challenge|just a moment|attention required|g-recaptcha|hcaptcha|access denied|please enable javascript|verify you are human|bot detection|enable cookies to continue/i.test(
    head,
  );
}

export function isTextContent(contentType: string): boolean {
  if (!contentType) return true;
  return /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json|rss\+xml|atom\+xml))/i.test(
    contentType,
  );
}

function ruleMatches(rulePath: string, path: string): boolean {
  if (!rulePath) return false;
  const escaped = rulePath.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped).test(path);
}

/** Longest-match robots.txt Allow/Disallow for `*` and the named agent. */
export function robotsDisallows(robotsTxt: string, path: string, agent = "spectra"): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  type Rule = { allow: boolean; path: string };
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ allow: key === "allow", path: value });
    }
  }

  const ua = agent.toLowerCase();
  const matchesAgent = (a: string) => a === "*" || ua === a || ua.startsWith(a);
  const applicable = groups.filter((g) => g.agents.some(matchesAgent));
  const specific = applicable.filter((g) => g.agents.some((a) => a !== "*" && matchesAgent(a)));
  const use = specific.length ? specific : applicable.filter((g) => g.agents.includes("*"));

  let best: { allow: boolean; len: number } | null = null;
  for (const group of use) {
    for (const rule of group.rules) {
      if (!rule.path) continue;
      if (!ruleMatches(rule.path, path)) continue;
      if (!best || rule.path.length > best.len) best = { allow: rule.allow, len: rule.path.length };
    }
  }
  return Boolean(best && !best.allow);
}

const robotsCache = new Map<string, { at: number; txt: string }>();

async function readRobots(
  origin: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.txt;
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": SPECTRA_UA, Accept: "text/plain,*/*" },
    });
    if (!res.ok) {
      robotsCache.set(origin, { at: Date.now(), txt: "" });
      return "";
    }
    const txt = (await res.text()).slice(0, 200_000);
    robotsCache.set(origin, { at: Date.now(), txt });
    return txt;
  } catch {
    return "";
  }
}

export function clearRobotsCache(): void {
  robotsCache.clear();
}

/** True when robots.txt does not forbid the URL. Unreadable robots.txt fails open. */
export async function allowedByRobots(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!isPublicHttpUrl(url)) return false;
  try {
    const u = new URL(url);
    const robots = await readRobots(u.origin, fetchImpl, LIMITS.robotsTimeoutMs);
    if (!robots) return true;
    return !robotsDisallows(robots, `${u.pathname}${u.search}` || "/", "spectra");
  } catch {
    return true;
  }
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503;
}

async function oneGet(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ res: Response; body: string; contentType: string; finalUrl: string }> {
  let current = url;
  let res!: Response;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    if (!isPublicHttpUrl(current)) {
      throw new Error("URL odrzucony (adres prywatny, lokalny albo nie-HTTP)");
    }
    res = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = new URL(loc, current).href;
      continue;
    }
    break;
  }
  const contentType = res.headers.get("content-type") || "";
  let body = "";
  if (isTextContent(contentType)) {
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > LIMITS.maxBodyBytes ? buf.slice(0, LIMITS.maxBodyBytes) : buf;
    body = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  } else {
    await res.arrayBuffer().catch(() => undefined);
  }
  return { res, body, contentType, finalUrl: current };
}

export async function resilientGet(
  url: string,
  opts?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    respectRobots?: boolean;
    headers?: Record<string, string>;
  },
): Promise<HttpResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? LIMITS.fetchTimeoutMs;
  const t0 = Date.now();
  const fail = (partial: Partial<HttpResult> & { error: string }): HttpResult => ({
    ok: false,
    url: partial.url ?? url,
    statusCode: partial.statusCode ?? 0,
    contentType: partial.contentType ?? "",
    body: partial.body ?? "",
    blocked: partial.blocked ?? false,
    attempts: partial.attempts ?? 1,
    robotsBlocked: partial.robotsBlocked ?? false,
    durationMs: partial.durationMs ?? Date.now() - t0,
    error: partial.error,
  });

  if (!isPublicHttpUrl(url)) {
    return fail({ error: "URL odrzucony (adres prywatny, lokalny albo nie-HTTP)" });
  }

  if (opts?.respectRobots !== false) {
    try {
      const u = new URL(url);
      const robots = await readRobots(u.origin, fetchImpl, LIMITS.robotsTimeoutMs);
      const path = `${u.pathname}${u.search}` || "/";
      if (robots && robotsDisallows(robots, path, "spectra")) {
        return fail({
          error: "robots.txt zabrania tej ścieżki",
          robotsBlocked: true,
          url,
        });
      }
    } catch {
      /* fail open when robots.txt itself cannot be read */
    }
  }

  let attempts = 0;
  let lastError = "Pobranie nie powiodło się";
  const profiles = [CHROME_HEADERS, ALT_HEADERS];

  for (let i = 0; i < profiles.length; i++) {
    attempts += 1;
    try {
      const { res, body, contentType, finalUrl } = await oneGet(
        url,
        { ...profiles[i], ...opts?.headers },
        fetchImpl,
        timeoutMs,
      );
      const blocked = looksBlocked(res.status, body);
      const text = isTextContent(contentType);
      const ok = res.status > 0 && res.status < 400 && !blocked && text;
      if (!ok && i === 0 && (blocked || retryable(res.status) || !text)) {
        if (!isTextContent(contentType) && res.status < 400) {
          return {
            ok: false,
            url: finalUrl,
            statusCode: res.status,
            contentType,
            body: "",
            blocked: false,
            attempts,
            robotsBlocked: false,
            durationMs: Date.now() - t0,
            error: `Nieobsługiwany typ treści: ${contentType || "nieznany"}`,
          };
        }
        lastError = blocked
          ? `Odpowiedź wygląda na blokadę (${res.status})`
          : `HTTP ${res.status}`;
        continue;
      }
      return {
        ok,
        url: finalUrl,
        statusCode: res.status,
        contentType,
        body,
        blocked,
        attempts,
        robotsBlocked: false,
        durationMs: Date.now() - t0,
        error: res.status >= 400 ? `HTTP ${res.status}` : blocked ? lastError : undefined,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Błąd sieci";
    }
  }

  return fail({ error: lastError, attempts, blocked: /blokad|403|429|503/i.test(lastError) });
}
