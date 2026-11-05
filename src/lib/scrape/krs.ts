import type { CapexPerson } from "./capex.ts";
import { SPECTRA_UA } from "./http.ts";
import type { SourceResult } from "./types.ts";

/**
 * Public Ministry of Justice extract. No key.
 * NIP → KRS uses the public VAT whitelist (no key). CEIDG is not called:
 * a sole trader has no KRS number and the CEIDG API needs a token plus an OK.
 */
export const CEIDG_LIMIT_NOTE =
  "CEIDG: nie odpytujemy. Odczyt działalności osoby fizycznej (JDG) wymaga tokenu Biznes.gov.pl i osobnego OK. Sam NIP bez numeru KRS nie wciąga zarządu.";

const KRS_ORIGIN = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny";
const VAT_HOSTS = [
  "https://wykazpodatnikowvat.mf.gov.pl/api/search/nip",
  "https://wl-api.mf.gov.pl/api/search/nip",
];
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

export interface KrsRegistry {
  krs?: string;
  nip?: string;
  name?: string;
  people: CapexPerson[];
  sourceUrl?: string;
  sourceTitle?: string;
  markdown?: string;
  note?: string;
}

interface ParsedExtract {
  krs: string;
  name: string;
  nip?: string;
  people: CapexPerson[];
  sourceUrl: string;
  sourceTitle: string;
  markdown: string;
}

/** Drop PESEL and other 11-digit personal ids. Company NIP (10 digits) stays. */
export function scrubPersonalIds(text: string): string {
  return text
    .replace(/PESEL\s*[:.]?\s*\d{11}/gi, "")
    .replace(/\b\d{11}\b/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;])/g, "$1")
    .trim();
}

export function isValidNip(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(nip[i]) * NIP_WEIGHTS[i];
  const mod = sum % 11;
  if (mod === 10) return false;
  return mod === Number(nip[9]);
}

export function normalizeKrs(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits || digits.length > 10) return null;
  const padded = digits.padStart(10, "0");
  if (/^0+$/.test(padded)) return null;
  return padded;
}

export function normalizeNip(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!isValidNip(digits)) return null;
  return digits;
}

/** Labeled KRS / NIP only. Bare 10-digit strings in page text are too noisy. */
export function extractRegistryIds(text: string): { krs?: string; nip?: string } {
  const sample = text.slice(0, 80_000);
  let krs: string | undefined;
  let nip: string | undefined;
  const krsRe = /\bKRS[:\s.-]*(\d{1,10})\b/gi;
  const nipRe = /\bNIP[:\s.-]*(\d{3})[-\s]?(\d{3})[-\s]?(\d{2})[-\s]?(\d{2})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = krsRe.exec(sample))) {
    const normalized = normalizeKrs(match[1] ?? "");
    if (normalized) {
      krs = normalized;
      break;
    }
  }
  while ((match = nipRe.exec(sample))) {
    const normalized = normalizeNip(`${match[1]}${match[2]}${match[3]}${match[4]}`);
    if (normalized) {
      nip = normalized;
      break;
    }
  }
  return {
    ...(krs ? { krs } : {}),
    ...(nip ? { nip } : {}),
  };
}

export function warsawDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function krsExtractUrl(krs: string, rejestr: "P" | "S"): string {
  return `${KRS_ORIGIN}/${krs}?rejestr=${rejestr}&format=json`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function personName(raw: Record<string, unknown>): string {
  const nazwisko = asRecord(raw.nazwisko);
  const imiona = asRecord(raw.imiona);
  const first = [imiona?.imie, imiona?.imieDrugie]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
  const last = [nazwisko?.nazwiskoICzlon, nazwisko?.nazwiskoIICzlon]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
  return scrubPersonalIds(`${first} ${last}`.replace(/\s+/g, " ").trim());
}

function pushPeople(
  out: CapexPerson[],
  list: unknown,
  kind: CapexPerson["kind"],
  fallbackRole: string,
) {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (out.length >= 24) return;
    const raw = asRecord(item);
    if (!raw) continue;
    const name = personName(raw);
    if (name.length < 3) continue;
    const roleSource = kind === "zarzad" ? raw.funkcjaWOrganie : raw.rodzajProkury;
    let role = scrubPersonalIds(typeof roleSource === "string" ? roleSource : fallbackRole);
    if (!role) role = fallbackRole;
    if (raw.czyZawieszona === true) role = `${role} (czynności zawieszone)`;
    if (role.length > 180) role = `${role.slice(0, 177).trimEnd()}…`;
    out.push({ name, role, kind });
  }
}

export function parseKrsOdpis(json: unknown, krs: string, sourceUrl: string): ParsedExtract | null {
  const odpis = asRecord(asRecord(json)?.odpis);
  if (!odpis) return null;
  const dane = asRecord(odpis.dane);
  const dzial1 = asRecord(dane?.dzial1);
  const podmiot = asRecord(dzial1?.danePodmiotu);
  const ids = asRecord(podmiot?.identyfikatory);
  const name = typeof podmiot?.nazwa === "string" ? podmiot.nazwa.trim() : "";
  const nip = typeof ids?.nip === "string" ? (normalizeNip(ids.nip) ?? undefined) : undefined;
  const dzial2 = asRecord(dane?.dzial2);
  const people: CapexPerson[] = [];
  const reps = dzial2?.reprezentacja;
  const repList = Array.isArray(reps) ? reps : reps ? [reps] : [];
  let sposob = "";
  for (const rep of repList) {
    const rec = asRecord(rep);
    if (!rec) continue;
    if (!sposob && typeof rec.sposobReprezentacji === "string") sposob = rec.sposobReprezentacji;
    pushPeople(people, rec.sklad, "zarzad", "CZŁONEK ZARZĄDU");
  }
  pushPeople(people, dzial2?.prokurenci, "prokurent", "PROKURENT");

  const lines = [
    `# KRS ${krs}${name ? ` — ${name}` : ""}`,
    "",
    "Odpis aktualny, api-krs.ms.gov.pl.",
  ];
  if (nip) lines.push(`NIP: ${nip}`);
  const sposobClean = scrubPersonalIds(sposob);
  if (sposobClean) lines.push("", `Sposób reprezentacji: ${sposobClean}`);
  const board = people.filter((person) => person.kind === "zarzad");
  const proxies = people.filter((person) => person.kind === "prokurent");
  lines.push("", "## Zarząd");
  if (board.length === 0) lines.push("Brak wpisów.");
  for (const person of board) lines.push(`- ${person.name} — ${person.role}`);
  lines.push("", "## Prokurenci");
  if (proxies.length === 0) lines.push("Brak wpisów.");
  for (const person of proxies) lines.push(`- ${person.name} — ${person.role}`);
  const markdown = scrubPersonalIds(lines.join("\n"));
  return {
    krs,
    name,
    nip,
    people,
    sourceUrl,
    sourceTitle: `KRS ${krs}${name ? ` — ${name}` : ""}`,
    markdown,
  };
}

export async function fetchKrsExtract(
  krs: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ParsedExtract | null> {
  const id = normalizeKrs(krs);
  if (!id) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  for (const rejestr of ["P", "S"] as const) {
    const url = krsExtractUrl(id, rejestr);
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": SPECTRA_UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`KRS HTTP ${res.status}`);
    const parsed = parseKrsOdpis(await res.json(), id, url);
    if (parsed) return parsed;
  }
  return null;
}

interface VatSubject {
  name?: string;
  nip?: string;
  krs?: string | null;
}

async function krsFromNip(
  nip: string,
  opts: { fetchImpl: typeof fetch; timeoutMs: number; now?: Date },
): Promise<{ krs?: string; name?: string; nip?: string; note?: string }> {
  const date = warsawDate(opts.now);
  let lastError = "brak odpowiedzi";
  for (const base of VAT_HOSTS) {
    const url = `${base}/${nip}?date=${date}`;
    try {
      const res = await opts.fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": SPECTRA_UA },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (res.status === 400 || res.status === 404) return { nip, note: CEIDG_LIMIT_NOTE };
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const body = (await res.json()) as { result?: { subject?: VatSubject | null } };
      const subject = body.result?.subject;
      if (!subject) return { nip, note: CEIDG_LIMIT_NOTE };
      const krs =
        typeof subject.krs === "string" ? (normalizeKrs(subject.krs) ?? undefined) : undefined;
      const name = subject.name?.trim() || undefined;
      if (!krs) return { nip, name, note: CEIDG_LIMIT_NOTE };
      const subjectNip = subject.nip ? normalizeNip(subject.nip) : null;
      return { krs, name, nip: subjectNip ?? nip };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "błąd";
    }
  }
  return {
    nip,
    note: `Wykaz VAT niedostępny (${lastError.slice(0, 80)}). CEIDG nie jest podłączone — podaj numer KRS.`,
  };
}

/** KRS extract, or NIP resolved through the public VAT whitelist. Never calls CEIDG. */
export async function resolveCapexRegistry(input: {
  krs?: string;
  nip?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
}): Promise<KrsRegistry> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 8_000;
  let krs = input.krs ? (normalizeKrs(input.krs) ?? undefined) : undefined;
  let nip = input.nip ? (normalizeNip(input.nip) ?? undefined) : undefined;
  let note: string | undefined;
  let whitelistName: string | undefined;

  if (!krs && !nip) return { people: [] };

  if (!krs && nip) {
    const resolved = await krsFromNip(nip, { fetchImpl, timeoutMs, now: input.now });
    krs = resolved.krs;
    nip = resolved.nip ?? nip;
    whitelistName = resolved.name;
    note = resolved.note;
  }

  if (!krs) {
    return { nip, name: whitelistName, people: [], note: note ?? CEIDG_LIMIT_NOTE };
  }

  try {
    const extract = await fetchKrsExtract(krs, { fetchImpl, timeoutMs });
    if (!extract) {
      return {
        krs,
        nip,
        name: whitelistName,
        people: [],
        note: `Brak odpisu aktualnego dla KRS ${krs} (rejestry P i S).`,
      };
    }
    return {
      krs: extract.krs,
      nip: extract.nip ?? nip,
      name: extract.name || whitelistName,
      people: extract.people,
      sourceUrl: extract.sourceUrl,
      sourceTitle: extract.sourceTitle,
      markdown: extract.markdown,
      note: extract.people.length ? undefined : "Odpis KRS nie zawiera zarządu ani prokurentów.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "błąd KRS";
    return {
      krs,
      nip,
      name: whitelistName,
      people: [],
      note: `KRS niedostępne (${message.slice(0, 140)})`,
    };
  }
}

export function krsSourceResult(registry: KrsRegistry): SourceResult | null {
  if (!registry.markdown || !registry.sourceUrl) return null;
  const description = registry.people
    .map((person) => `${person.name} — ${person.role}`)
    .join("; ")
    .slice(0, 280);
  return {
    url: registry.sourceUrl,
    title: registry.sourceTitle || `KRS ${registry.krs ?? ""}`.trim(),
    description,
    markdown: registry.markdown,
    textPreview: registry.markdown.replace(/[#>*`[\]]/g, "").slice(0, 600),
    links: [],
    media: [],
    structured: registry.people.map((person) => ({
      key: person.kind === "zarzad" ? "krs.zarzad" : "krs.prokurent",
      value: `${person.name} — ${person.role}`,
      source: "krs",
    })),
    patterns: [],
    interactive: [],
    mobile: { hasAppLinks: false, isMobileOptimized: false },
    wordCount: registry.markdown.split(/\s+/).filter(Boolean).length,
    statusCode: 200,
    contentType: "application/json",
    engines: [],
    fetchedAt: new Date().toISOString(),
  };
}
