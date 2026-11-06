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

/** Zones that answer with an address embedded in the name, usually loopback. */
const SSRF_HELPER_ZONES = ["nip.io", "localtest.me", "sslip.io", "lvh.me"];

function ipv4IsPrivate(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function parseIPv4(raw: string): number[] | null {
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Eight 16-bit groups, or null when the text is not an IPv6 address. */
function expandIPv6(addr: string): number[] | null {
  let s = addr.toLowerCase();
  const lastColon = s.lastIndexOf(":");
  if (lastColon >= 0) {
    const tail = s.slice(lastColon + 1);
    if (tail.includes(".")) {
      const v4 = parseIPv4(tail);
      if (!v4) return null;
      const hi = ((v4[0] << 8) | v4[1]).toString(16);
      const lo = ((v4[2] << 8) | v4[3]).toString(16);
      s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
    }
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tailGroups = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tailGroups.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...tailGroups];
  if (groups.length !== 8) return null;
  const nums: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    nums.push(Number.parseInt(group, 16));
  }
  return nums;
}

function octetsFromGroups(hi: number, lo: number): number[] {
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
}

export function ipIsPrivate(ip: string): boolean {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!raw) return true;
  if (raw.includes(":")) {
    const groups = expandIPv6(raw);
    if (!groups) return true;
    if (groups.every((group) => group === 0)) return true;
    if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
    if ((groups[0] & 0xffc0) === 0xfe80) return true;
    if ((groups[0] & 0xfe00) === 0xfc00) return true;
    if ((groups[0] & 0xff00) === 0xff00) return true;
    const mapped =
      groups[0] === 0 &&
      groups[1] === 0 &&
      groups[2] === 0 &&
      groups[3] === 0 &&
      groups[4] === 0 &&
      groups[5] === 0xffff;
    if (mapped) return ipv4IsPrivate(octetsFromGroups(groups[6], groups[7]));
    const compatible = groups.slice(0, 6).every((group) => group === 0);
    if (compatible) return ipv4IsPrivate(octetsFromGroups(groups[6], groups[7]));
    return false;
  }
  const v4 = parseIPv4(raw);
  if (!v4) return false;
  return ipv4IsPrivate(v4);
}

function isSsrfHelperHost(host: string): boolean {
  return SSRF_HELPER_ZONES.some((zone) => host === zone || host.endsWith(`.${zone}`));
}

function looksLikeIp(host: string): boolean {
  return host.includes(":") || Boolean(parseIPv4(host)) || isIP(host) !== 0;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localdomain")) {
    return true;
  }
  if (isSsrfHelperHost(host)) return true;
  if (looksLikeIp(host)) return ipIsPrivate(host);
  return false;
}

export type DnsLookup = (hostname: string) => Promise<string[]>;

const dnsCache = new Map<string, { at: number; addrs: string[] | null }>();

export function clearDnsCache(): void {
  dnsCache.clear();
}

export async function defaultDnsLookup(hostname: string): Promise<string[]> {
  const key = hostname.toLowerCase().replace(/\.$/, "");
  const hit = dnsCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) {
    if (!hit.addrs) throw new Error("dns lookup failed");
    return hit.addrs;
  }
  try {
    const dns = await import("node:dns/promises");
    const records = await dns.lookup(key, { all: true, verbatim: true });
    const addrs = records.map((record) => record.address);
    dnsCache.set(key, { at: Date.now(), addrs });
    return addrs;
  } catch (err) {
    dnsCache.set(key, { at: Date.now(), addrs: null });
    throw err;
  }
}

/** Sync shape check, then A/AAAA. Any private answer, or a failed lookup, rejects the URL. */
export async function isPublicHttpUrlResolved(
  raw: string,
  lookup: DnsLookup = defaultDnsLookup,
): Promise<boolean> {
  if (!isPublicHttpUrl(raw)) return false;
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  } catch {
    return false;
  }
  if (looksLikeIp(host)) return !ipIsPrivate(host);
  try {
    const addrs = await lookup(host);
    if (!addrs.length) return false;
    return addrs.every((addr) => !ipIsPrivate(addr));
  } catch {
    return false;
  }
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
  lookup: DnsLookup,
): Promise<string> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.txt;
  let current = `${origin}/robots.txt`;
  try {
    for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
      if (!(await isPublicHttpUrlResolved(current, lookup))) return "";
      const res = await fetchImpl(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": SPECTRA_UA, Accept: "text/plain,*/*" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!loc) return "";
        current = new URL(loc, current).href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        robotsCache.set(origin, { at: Date.now(), txt: "" });
        return "";
      }
      const txt = (await res.text()).slice(0, 200_000);
      robotsCache.set(origin, { at: Date.now(), txt });
      return txt;
    }
    return "";
  } catch {
    return "";
  }
}

export function clearRobotsCache(): void {
  robotsCache.clear();
}

/**
 * GET with manual redirects. Each hop, including a URL the client reports as
 * `response.url`, must be public HTTP. A private target is never requested.
 */
export async function publicFetch(
  url: string,
  opts: {
    fetchImpl?: typeof fetch;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    lookup?: DnsLookup;
  } = {},
): Promise<{ response: Response; finalUrl: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const lookup = opts.lookup ?? defaultDnsLookup;
  const timeoutMs = opts.timeoutMs ?? LIMITS.discoveryTimeoutMs;
  let current = url;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    if (!(await isPublicHttpUrlResolved(current, lookup))) {
      throw new Error("URL odrzucony (adres prywatny, lokalny albo nie-HTTP)");
    }
    const response = await fetchImpl(current, {
      redirect: "manual",
      signal: opts.signal ?? AbortSignal.timeout(timeoutMs),
      headers: opts.headers,
    });
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!loc) return { response, finalUrl: current };
      current = new URL(loc, current).href;
      continue;
    }
    const reported = response.url?.startsWith("http") ? response.url : current;
    if (reported !== current && !(await isPublicHttpUrlResolved(reported, lookup))) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("URL odrzucony (adres prywatny, lokalny albo nie-HTTP)");
    }
    return { response, finalUrl: reported };
  }
  throw new Error("Za dużo przekierowań");
}

/** True when robots.txt does not forbid the URL. Unreadable robots.txt fails open. */
export async function allowedByRobots(
  url: string,
  fetchImpl: typeof fetch = fetch,
  lookup: DnsLookup = defaultDnsLookup,
): Promise<boolean> {
  if (!(await isPublicHttpUrlResolved(url, lookup))) return false;
  try {
    const u = new URL(url);
    const robots = await readRobots(u.origin, fetchImpl, LIMITS.robotsTimeoutMs, lookup);
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
  lookup: DnsLookup,
): Promise<{ res: Response; body: string; contentType: string; finalUrl: string }> {
  let current = url;
  let res!: Response;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    if (!(await isPublicHttpUrlResolved(current, lookup))) {
      throw new Error("URL odrzucony (adres prywatny, lokalny albo nie-HTTP)");
    }
    res = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
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
    lookup?: DnsLookup;
  },
): Promise<HttpResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const lookup = opts?.lookup ?? defaultDnsLookup;
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

  if (!(await isPublicHttpUrlResolved(url, lookup))) {
    return fail({ error: "URL odrzucony (adres prywatny, lokalny albo nie-HTTP)" });
  }

  if (opts?.respectRobots !== false) {
    try {
      const u = new URL(url);
      const robots = await readRobots(u.origin, fetchImpl, LIMITS.robotsTimeoutMs, lookup);
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
        lookup,
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
