/**
 * Ministry of Finance public VAT whitelist (Wykaz podatników VAT).
 * @see https://www.gov.pl/web/kas/api-wykazu-podatnikow-vat
 */

/** Production API base (valid from 2026-10-15; wl-api.mf.gov.pl until 2026-12-01). */
export const MF_WL_API_DEFAULT_BASE_URL = "https://wykazpodatnikowvat.mf.gov.pl/api";

/** Former production host; MF redirects until 2026-12-01 — used as fallback when default base is set. */
export const MF_WL_API_LEGACY_BASE_URL = "https://wl-api.mf.gov.pl/api";

/** MF test environment (not used unless MF_WL_API_BASE_URL points here). */
export const MF_WL_API_TEST_BASE_URL = "https://wykazpodatnikowvat-test.mf.gov.pl/api";

function normalizeApiBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** Resolved API root (`…/api`), from `MF_WL_API_BASE_URL` or {@link MF_WL_API_DEFAULT_BASE_URL}. */
export function getMfVatWlApiBaseUrl(): string {
  const fromEnv =
    typeof process !== "undefined" ? process.env.MF_WL_API_BASE_URL?.trim() : undefined;
  if (fromEnv) return normalizeApiBase(fromEnv);
  return MF_WL_API_DEFAULT_BASE_URL;
}

/** Prefix for `GET …/search/nip/{nip}?date=YYYY-MM-DD` (no trailing slash). */
export function getMfVatWlSearchNipPrefix(baseUrl = getMfVatWlApiBaseUrl()): string {
  return `${normalizeApiBase(baseUrl)}/search/nip`;
}

export function buildMfVatWlSearchNipUrl(
  nip: string,
  date: string,
  baseUrl = getMfVatWlApiBaseUrl(),
): string {
  return `${getMfVatWlSearchNipPrefix(baseUrl)}/${nip}?date=${date}`;
}

/**
 * Hosts to try for NIP → KRS (primary first). When using the official production base,
 * the legacy wl-api host is tried second until MF retires it (2026-12-01).
 */
export function getMfVatWlSearchNipPrefixes(): string[] {
  const base = getMfVatWlApiBaseUrl();
  const primary = getMfVatWlSearchNipPrefix(base);
  if (base === MF_WL_API_DEFAULT_BASE_URL) {
    return [primary, `${MF_WL_API_LEGACY_BASE_URL}/search/nip`];
  }
  return [primary];
}