import assert from "node:assert/strict";
import test from "node:test";
import type { SourceResult } from "./types.ts";
import {
  FUNCTION_MAX_DURATION_SEC,
  FUNCTION_SAFETY_MS,
  LIMITS,
  MIN_SYNTHESIS_MS,
  SYNTHESIS_TIMEOUT_MS,
  synthesisAbortMs,
} from "./limits.ts";
import { resolveXaiModel, synthesisTimeoutMessage, synthesizeWithGrok } from "../xai.ts";

function sourceWithMarkdown(markdown: string): SourceResult {
  return {
    url: "https://autoproces.pl/",
    title: "Autoproces",
    description: "Automatyzacja",
    markdown,
    textPreview: "Automatyzacja",
    links: [],
    media: [],
    structured: [],
    patterns: [],
    interactive: [],
    mobile: { hasAppLinks: false, isMobileOptimized: true },
    wordCount: 2900,
    statusCode: 200,
    contentType: "text/html",
    engines: [],
    fetchedAt: "2026-11-05T00:00:00.000Z",
  };
}

test("a full crawl still leaves the 90s Grok ceiling", () => {
  assert.equal(FUNCTION_MAX_DURATION_SEC, 180);
  assert.equal(SYNTHESIS_TIMEOUT_MS, 90_000);
  assert.ok(LIMITS.searchBudgetMs + SYNTHESIS_TIMEOUT_MS + FUNCTION_SAFETY_MS < FUNCTION_MAX_DURATION_SEC * 1000);
  assert.equal(synthesisAbortMs(0), SYNTHESIS_TIMEOUT_MS);
  assert.equal(synthesisAbortMs(LIMITS.searchBudgetMs), SYNTHESIS_TIMEOUT_MS);
  const partial = FUNCTION_MAX_DURATION_SEC * 1000 - FUNCTION_SAFETY_MS - 50_000;
  assert.equal(synthesisAbortMs(partial), 50_000);
  const tooLate = FUNCTION_MAX_DURATION_SEC * 1000 - FUNCTION_SAFETY_MS - (MIN_SYNTHESIS_MS - 1);
  assert.equal(synthesisAbortMs(tooLate), 0);
  assert.equal(synthesisAbortMs(Number.NaN), SYNTHESIS_TIMEOUT_MS);
});

test("model default stays grok-4.3 unless XAI_MODEL is set", () => {
  const prev = process.env.XAI_MODEL;
  try {
    delete process.env.XAI_MODEL;
    assert.equal(resolveXaiModel(), "grok-4.3");
    process.env.XAI_MODEL = "   ";
    assert.equal(resolveXaiModel(), "grok-4.3");
    process.env.XAI_MODEL = "grok-custom";
    assert.equal(resolveXaiModel(), "grok-custom");
  } finally {
    if (prev === undefined) delete process.env.XAI_MODEL;
    else process.env.XAI_MODEL = prev;
  }
});

test("synthesis timeout copy uses the budget that was actually armed", () => {
  assert.equal(
    synthesisTimeoutMessage(90_000),
    "Synteza Grok przerwana po 90 s, żeby zmieścić się w limicie funkcji",
  );
  assert.equal(
    synthesisTimeoutMessage(12_000),
    "Synteza Grok przerwana po 12 s, żeby zmieścić się w limicie funkcji",
  );
});

test("Grok request keeps grok-4.3 and does not send the full page", async () => {
  const prevKey = process.env.XAI_API_KEY;
  const prevModel = process.env.XAI_MODEL;
  process.env.XAI_API_KEY = "test-key";
  delete process.env.XAI_MODEL;
  const original = globalThis.fetch;
  let seenModel = "";
  let seenUser = "";
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    seenModel = body.model;
    seenUser = body.messages.find((m) => m.role === "user")?.content ?? "";
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "Autoproces automatyzuje produkcję.",
              keyPoints: ["Automatyzacja"],
              confidence: 0.8,
              citations: [{ title: "Autoproces", url: "https://autoproces.pl/" }],
            }),
          },
        },
      ],
    });
  }) as typeof fetch;
  try {
    const markdown = "x".repeat(20_000);
    const ai = await synthesizeWithGrok({
      query: "https://autoproces.pl",
      mode: "url",
      hits: [],
      sources: [sourceWithMarkdown(markdown)],
      timeoutMs: 90_000,
    });
    assert.equal(ai.used, true);
    assert.equal(ai.model, "grok-4.3");
    assert.equal(seenModel, "grok-4.3");
    assert.equal(seenUser.match(/x+/)?.[0].length, 2800);
    assert.equal(ai.answer, "Autoproces automatyzuje produkcję.");
  } finally {
    globalThis.fetch = original;
    if (prevKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prevKey;
    if (prevModel === undefined) delete process.env.XAI_MODEL;
    else process.env.XAI_MODEL = prevModel;
  }
});

test("a timed-out Grok call reports that budget in Polish", async () => {
  const prevKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-key";
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const backup = setTimeout(() => reject(new Error("signal was not aborted")), 2_000);
      const fail = () => {
        clearTimeout(backup);
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        reject(err);
      };
      if (init?.signal?.aborted) fail();
      else init?.signal?.addEventListener("abort", fail, { once: true });
    });
  }) as typeof fetch;
  try {
    const ai = await synthesizeWithGrok({
      query: "https://autoproces.pl",
      mode: "url",
      hits: [],
      sources: [sourceWithMarkdown("krótka treść")],
      timeoutMs: 200,
    });
    assert.equal(ai.used, false);
    assert.equal(ai.error, synthesisTimeoutMessage(200));
  } finally {
    globalThis.fetch = original;
    if (prevKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prevKey;
  }
});

test("no time left skips the xAI call", async () => {
  const prevKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-key";
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({});
  }) as typeof fetch;
  try {
    const ai = await synthesizeWithGrok({
      query: "https://autoproces.pl",
      mode: "url",
      hits: [],
      sources: [sourceWithMarkdown("treść")],
      timeoutMs: 0,
    });
    assert.equal(calls, 0);
    assert.equal(ai.used, false);
    assert.match(ai.error ?? "", /za mało czasu funkcji/);
  } finally {
    globalThis.fetch = original;
    if (prevKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prevKey;
  }
});
