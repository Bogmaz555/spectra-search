import { CAPEX_CHECKLIST, type CapexCard } from "./scrape/capex.ts";
import { capexDeepLink } from "./scrape/capex-link.ts";
import { SYNTHESIS_TIMEOUT_MS } from "./scrape/limits.ts";
import type { SearchHit, SourceResult, SpectraAi } from "@/lib/scrape/types";

/** Widely available chat model. Override with a non-empty `XAI_MODEL`. */
const DEFAULT_XAI_MODEL = "grok-4.3";

export function synthesisTimeoutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `Synteza Grok przerwana po ${seconds} s, żeby zmieścić się w limicie funkcji`;
}

export function hasXaiKey(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

/** One resolved slug for status, the request body, and error payloads. */
export function resolveXaiModel(): string {
  const override = process.env.XAI_MODEL?.trim();
  return override || DEFAULT_XAI_MODEL;
}

export function getXaiStatus(): {
  available: boolean;
  model: string;
  note: string;
} {
  const available = hasXaiKey();
  const model = resolveXaiModel();
  return {
    available,
    model,
    note: available
      ? `klucz ustawiony · model ${model}`
      : "Ustaw XAI_API_KEY na Vercel, aby włączyć syntezę Grok",
  };
}

/** Cap payload size so we don't burn tokens on full page dumps */
function packSources(sources: SourceResult[], hits: SearchHit[]): string {
  const hitLines = hits
    .slice(0, 8)
    .map((h, i) => `${i + 1}. [${h.title}](${h.url}) — ${h.snippet.slice(0, 160)}`)
    .join("\n");

  const sourceBlocks = sources.slice(0, 3).map((s, i) => {
    const md = s.markdown.slice(0, 2800);
    const struct = s.structured
      .slice(0, 12)
      .map((f) => `${f.key}: ${f.value}`)
      .join("\n");
    return [
      `### Źródło ${i + 1}: ${s.title}`,
      `URL: ${s.url}`,
      `HTTP ${s.statusCode} · ${s.wordCount} słów`,
      s.description ? `Opis: ${s.description}` : "",
      struct ? `Pola:\n${struct}` : "",
      md ? `Treść (skrót):\n${md}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [`## Discovery\n${hitLines || "(brak)"}`, ...sourceBlocks].join("\n\n");
}

export async function synthesizeWithGrok(input: {
  query: string;
  mode: string;
  hits: SearchHit[];
  sources: SourceResult[];
  /** Abort the xAI call after this many ms. 0 skips the call (no time left). */
  timeoutMs?: number;
  /** Company name: switch to the CapEx / investment research prompt. */
  capex?: string;
  /** Official KRS extract (names and roles, no PESEL) already fetched for this scan. */
  registryContext?: string;
}): Promise<SpectraAi> {
  const model = resolveXaiModel();
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      enabled: false,
      used: false,
      model,
      answer: "",
      keyPoints: [],
      confidence: 0,
      citations: [],
      error: "Brak XAI_API_KEY — dodaj klucz w ustawieniach Vercel",
    };
  }

  if (input.sources.length === 0 && input.hits.length === 0) {
    return {
      enabled: true,
      used: false,
      model,
      answer: "",
      keyPoints: [],
      confidence: 0,
      citations: [],
      error: "Brak źródeł do syntezy",
    };
  }

  const timeoutMs = input.timeoutMs ?? SYNTHESIS_TIMEOUT_MS;
  if (timeoutMs <= 0) {
    return {
      enabled: true,
      used: false,
      model,
      answer: "",
      keyPoints: [],
      confidence: 0,
      citations: [],
      error: "Synteza Grok pominięta — po pobraniu stron zostało za mało czasu funkcji",
    };
  }

  const context = packSources(input.sources, input.hits);
  const system: string = [
    "Jesteś warstwą inteligencji portalu SPECTRA.",
    "Na podstawie WYŁĄCZNIE podanych źródeł przygotuj zwięzłą odpowiedź po polsku.",
    "Nie wymyślaj faktów spoza źródeł. Jeśli coś jest niepewne — napisz to.",
    "Cytuj źródła po tytule/URL gdy to możliwe.",
    "Zwróć WYŁĄCZNIE poprawny JSON (bez markdown fences) o schemacie:",
    '{ "answer": "string (2-5 akapitów markdown)", "keyPoints": ["..."], "confidence": 0.0-1.0, "citations": [{"title":"...","url":"..."}] }',
  ].join(" ");

  const systemText = input.capex
    ? [
        "Jesteś analitykiem rynku przemysłowego PL dla firmy integratora automatyki i pakowania (Autoproces).",
        `Badana firma: ${input.capex}.`,
        "Na podstawie WYŁĄCZNIE podanych źródeł wypisz inwestycje CapEx: nowe hale, linie produkcyjne, rozbudowy, automatyzację, robotyzację, magazyny, dotacje.",
        "Nie wymyślaj faktów; brak danych = pomiń pole. Każda inwestycja musi mieć URL źródła.",
        "Nie dopisuj członków zarządu ani prokurentów i nie podawaj PESEL — reprezentację dokleja odpis KRS.",
        "Zwróć WYŁĄCZNIE poprawny JSON (bez markdown fences) o schemacie:",
        '{ "answer": "markdown: podsumowanie inwestycji i szansy współpracy", "keyPoints": ["..."], "confidence": 0.0-1.0, "citations": [{"title":"...","url":"..."}], "capex": { "company": "...", "investments": [{"what":"...","value":"...","when":"...","location":"...","url":"..."}], "signals": ["sygnał zakupowy / potrzeba automatyzacji"], "checklist": [{"item":"...","done":true}] } }',
        `Checklista ma zawierać dokładnie te punkty (done=true tylko gdy źródło to potwierdza): ${CAPEX_CHECKLIST.join(" | ")}.`,
      ].join(" ")
    : system;
  const user = [
    `Zapytanie użytkownika: ${input.query}`,
    `Tryb: ${input.mode}`,
    "",
    "Źródła zebrane przez pipeline crawlerów:",
    context,
    ...(input.registryContext
      ? [
          "",
          "Reprezentacja z publicznego odpisu KRS (bez PESEL):",
          input.registryContext.slice(0, 2500),
        ]
      : []),
  ].join("\n");

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: input.capex ? 2200 : 1200,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        enabled: true,
        used: false,
        model,
        answer: "",
        keyPoints: [],
        confidence: 0,
        citations: [],
        error: `xAI API ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = body.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseAiJson(raw, input.hits, input.sources);
    const capex = input.capex ? parseCapexCard(raw, input.capex, parsed.citations) : undefined;

    return {
      enabled: true,
      used: true,
      model,
      answer: parsed.answer,
      keyPoints: parsed.keyPoints,
      confidence: parsed.confidence,
      citations: parsed.citations,
      ...(capex ? { capex } : {}),
    };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      enabled: true,
      used: false,
      model,
      answer: "",
      keyPoints: [],
      confidence: 0,
      citations: [],
      error: timedOut
        ? synthesisTimeoutMessage(timeoutMs)
        : e instanceof Error
          ? e.message
          : "Błąd syntezy",
    };
  }
}

function parseAiJson(
  raw: string,
  hits: SearchHit[],
  sources: SourceResult[],
): {
  answer: string;
  keyPoints: string[];
  confidence: number;
  citations: { title: string; url: string }[];
} {
  const fallbackCitations = [
    ...sources.map((s) => ({ title: s.title, url: s.url })),
    ...hits.map((h) => ({ title: h.title, url: h.url })),
  ].slice(0, 6);

  try {
    let text = raw.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    const data = JSON.parse(text) as {
      answer?: string;
      keyPoints?: string[];
      confidence?: number;
      citations?: { title?: string; url?: string }[];
    };
    return {
      answer: (data.answer || raw).trim(),
      keyPoints: Array.isArray(data.keyPoints)
        ? data.keyPoints.map(String).filter(Boolean).slice(0, 8)
        : [],
      confidence: clamp01(Number(data.confidence) || 0.55),
      citations:
        Array.isArray(data.citations) && data.citations.length
          ? data.citations
              .filter((c) => c?.url)
              .map((c) => ({ title: String(c.title || c.url), url: String(c.url) }))
              .slice(0, 8)
          : fallbackCitations,
    };
  } catch {
    return {
      answer: raw || "Nie udało się sparsować odpowiedzi modelu.",
      keyPoints: [],
      confidence: 0.4,
      citations: fallbackCitations,
    };
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Heuristic effectiveness score without LLM */
export function scoreEffectiveness(input: {
  hits: SearchHit[];
  sources: SourceResult[];
  resolvedMode: string;
  /** Share of query tokens found in fetched text, 0–1. */
  coverage?: number;
}): {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  factors: { label: string; ok: boolean; detail: string }[];
} {
  const factors: { label: string; ok: boolean; detail: string }[] = [];
  let points = 0;
  let max = 0;

  const add = (label: string, ok: boolean, weight: number, detail: string) => {
    max += weight;
    if (ok) points += weight;
    factors.push({ label, ok, detail });
  };

  add(
    "Discovery",
    input.hits.length > 0,
    20,
    input.hits.length ? `${input.hits.length} trafień z wielu źródeł` : "Brak wyników discovery",
  );

  const okSources = input.sources.filter((s) => s.statusCode > 0 && s.statusCode < 400);
  add(
    "Pobranie stron",
    okSources.length > 0,
    25,
    okSources.length
      ? `${okSources.length}/${input.sources.length} źródeł HTTP OK`
      : "Żadne źródło nie zostało pobrane (blokada / timeout)",
  );

  const words = okSources.reduce((s, x) => s + x.wordCount, 0);
  add(
    "Treść",
    words >= 80,
    20,
    words ? `${words.toLocaleString("pl-PL")} słów w markdown` : "Pusta treść",
  );

  const structured = okSources.reduce((s, x) => s + x.structured.length, 0);
  add(
    "Struktura",
    structured >= 3,
    15,
    structured ? `${structured} pól meta/schema` : "Brak pól strukturalnych",
  );

  const patterns = okSources.reduce((s, x) => s + x.patterns.length, 0);
  add(
    "Wzorce",
    patterns > 0,
    10,
    patterns ? `${patterns} grup wzorców` : "Brak powtarzalnych list",
  );

  const links = okSources.reduce((s, x) => s + x.links.length, 0);
  add("Graf linków", links >= 5, 10, links ? `${links} linków do dalszego crawla` : "Mało linków");

  if (typeof input.coverage === "number" && Number.isFinite(input.coverage)) {
    const pct = Math.round(Math.max(0, Math.min(1, input.coverage)) * 100);
    add(
      "Pokrycie zapytania",
      pct >= 50,
      15,
      `${pct}% tokenów zapytania występuje w pobranej treści`,
    );
  }

  const score = max ? Math.round((points / max) * 100) : 0;
  const grade: "A" | "B" | "C" | "D" | "F" =
    score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";

  return { score, grade, factors };
}

/** Pull the optional `capex` card out of the model JSON; always return a full checklist. */
export function parseCapexCard(
  raw: string,
  company: string,
  citations: { title: string; url: string }[],
): CapexCard {
  let data: { capex?: Partial<CapexCard> } = {};
  try {
    const text = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    data = JSON.parse(text) as typeof data;
  } catch {
    /* fall through to empty card */
  }
  const c = data.capex ?? {};
  const done = new Map(
    (Array.isArray(c.checklist) ? c.checklist : []).map((i) => [
      String(i?.item ?? ""),
      Boolean(i?.done),
    ]),
  );
  return {
    company: String(c.company || company),
    investments: (Array.isArray(c.investments) ? c.investments : [])
      .filter((i) => i && i.what)
      .slice(0, 10)
      .map((i) => ({
        what: String(i.what),
        value: i.value ? String(i.value) : undefined,
        when: i.when ? String(i.when) : undefined,
        location: i.location ? String(i.location) : undefined,
        url: i.url ? String(i.url) : undefined,
      })),
    signals: (Array.isArray(c.signals) ? c.signals : []).map(String).filter(Boolean).slice(0, 8),
    checklist: CAPEX_CHECKLIST.map((item) => ({ item, done: done.get(item) ?? false })),
    sources: citations,
    people: [],
    investigateUrl: capexDeepLink(String(c.company || company)),
  };
}
