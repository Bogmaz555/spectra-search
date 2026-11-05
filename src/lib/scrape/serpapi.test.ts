import assert from "node:assert/strict";
import test from "node:test";
import {
  SerpapiBudget,
  getSerpapiStatus,
  parseSerpapiGoogle,
  parseSerpapiGoogleNews,
  serpapiSearch,
} from "./serpapi.ts";

test("getSerpapiStatus reflects SERPAPI_API_KEY", () => {
  assert.equal(getSerpapiStatus({}).available, false);
  assert.equal(getSerpapiStatus({ SERPAPI_API_KEY: "abc" }).available, true);
  assert.match(getSerpapiStatus({ SERPAPI_API_KEY: "abc" }).note, /SerpAPI aktywne/);
});

test("budget caps calls per scan", () => {
  const b = new SerpapiBudget(2);
  assert.equal(b.tryConsume(), true);
  assert.equal(b.tryConsume(), true);
  assert.equal(b.tryConsume(), false);
  assert.equal(b.used, 2);
  assert.equal(b.remainingCalls, 0);
});

test("parseSerpapiGoogle maps organic_results and skips bad links", () => {
  const hits = parseSerpapiGoogle(
    {
      organic_results: [
        { title: "ORLEN inwestycja", link: "https://www.orlen.pl/a?utm_source=x", snippet: "hala" },
        { title: "bad", link: "javascript:alert(1)" },
        { title: "Dup", link: "https://orlen.pl/a" },
      ],
    },
    "serpapi",
    5,
  );
  assert.equal(hits.length, 2);
  assert.equal(hits[0].source, "serpapi");
  assert.ok(hits[0].url.includes("orlen.pl"));
});

test("parseSerpapiGoogleNews maps news_results", () => {
  const hits = parseSerpapiGoogleNews(
    {
      news_results: [
        {
          title: "Nowa linia",
          link: "https://www.wnp.pl/art/1",
          source: "WNP",
          date: "2 dni temu",
        },
      ],
    },
    "serpapi-news",
    3,
  );
  assert.equal(hits.length, 1);
  assert.match(hits[0].snippet, /WNP/);
});

test("serpapiSearch uses mocked fetch, gl/hl=pl, and respects budget/429", async () => {
  const calls: string[] = [];
  const budget = new SerpapiBudget(1);
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    assert.match(url, /engine=google/);
    assert.match(url, /gl=pl/);
    assert.match(url, /hl=pl/);
    assert.doesNotMatch(url, /api_key=$/);
    return new Response(
      JSON.stringify({
        organic_results: [{ title: "Hit", link: "https://example.com/x", snippet: "s" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const hits = await serpapiSearch({
    engine: "google",
    query: "inwestycje zakład produkcyjny Polska 2026",
    apiKey: "test-key",
    fetchImpl,
    limit: 3,
    budget,
  });
  assert.equal(hits.length, 1);
  assert.equal(budget.used, 1);

  await assert.rejects(
    () =>
      serpapiSearch({
        engine: "google",
        query: "again",
        apiKey: "test-key",
        fetchImpl,
        budget,
      }),
    /budget exhausted/,
  );

  const rateBudget = new SerpapiBudget(2);
  const rateFetch: typeof fetch = async () =>
    new Response("slow down", { status: 429 });
  await assert.rejects(
    () =>
      serpapiSearch({
        engine: "google_news",
        query: "ORLEN",
        apiKey: "test-key",
        fetchImpl: rateFetch,
        budget: rateBudget,
      }),
    /429/,
  );
  assert.equal(rateBudget.used, 1);
  assert.equal(calls.length, 1);
});
