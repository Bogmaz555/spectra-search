import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ENGINE_IDS } from "../engines.ts";
import { QUERY_SOURCES } from "../catalog.ts";
import { buildResearchStages, queryCoverage, type CascadeFacts } from "./cascade.ts";
import { DISCOVERY_PROVIDER_IDS, explainDiscoveryFailure } from "./discovery.ts";
import { krsDiscoveryStatus } from "./krs.ts";
import { hitOutcome } from "./outcome.ts";

const aiOff: CascadeFacts["ai"] = {
  used: false,
  model: "grok-4.3",
  citations: [],
};

function facts(partial: Partial<CascadeFacts>): CascadeFacts {
  return {
    mode: "search",
    query: "sztuczna inteligencja",
    discovery: [],
    hits: 0,
    pages: 0,
    cheapOk: 0,
    cheapFail: 0,
    cheapSkipped: 0,
    thinPages: 0,
    firecrawlCalls: 0,
    firecrawlOk: 0,
    browserCalls: 0,
    browserOk: 0,
    crawl4aiCalls: 0,
    crawl4aiOk: 0,
    followed: 0,
    words: 0,
    fields: 0,
    patterns: 0,
    hosts: 0,
    httpOk: 0,
    coverage: 0,
    covered: [],
    missing: [],
    citationTotal: 0,
    citationMatched: 0,
    useAi: false,
    ai: aiOff,
    ...partial,
  };
}

test("query coverage keeps digits and ignores short function words", () => {
  const result = queryCoverage("Mlekovita KRS 0000123456 oraz inwestycja", "Mlekovita buduje halę");
  assert.equal(result.covered.includes("mlekovita"), true);
  assert.equal(result.missing.includes("0000123456"), true);
  assert.equal(result.missing.includes("oraz"), false);
  assert.equal(queryCoverage("https://example.com", "Example Domain").ratio > 0, true);
});

test("empty news is not an error and a total transport failure is", () => {
  assert.equal(hitOutcome(0, 0, 5), "skipped");
  assert.equal(hitOutcome(3, 1, 5), "live");
  assert.equal(hitOutcome(0, 5, 5), "error");
  assert.equal(hitOutcome(0, 1, 5), "error");
});

test("KRS distinguishes a missing id from an outage", () => {
  assert.equal(krsDiscoveryStatus(null).status, "skipped");
  assert.match(krsDiscoveryStatus(null).message, /Nie dotyczy/);
  assert.equal(
    krsDiscoveryStatus({ people: [], note: "KRS niedostępne (HTTP 503)" }).status,
    "error",
  );
  assert.equal(
    krsDiscoveryStatus({
      people: [{ name: "JAN KOWALSKI", role: "PREZES", kind: "zarzad" }],
      krs: "0000123456",
    }).status,
    "live",
  );
});

test("DuckDuckGo failure text names the source and leaves the others alone", () => {
  const message = explainDiscoveryFailure("duckduckgo", "DuckDuckGo HTML", new Error("HTTP 403"));
  assert.match(message, /403/);
  assert.match(message, /Wikipedia/);
  assert.doesNotMatch(message, /SERPAPI|api_key|secret/i);
});

test("default scan does not include scrcpy, Scrapy or Crawlee", () => {
  assert.equal(DEFAULT_ENGINE_IDS.includes("scrcpy"), false);
  assert.equal(DEFAULT_ENGINE_IDS.includes("scrapy"), false);
  assert.equal(DEFAULT_ENGINE_IDS.includes("crawlee"), false);
  assert.equal(DEFAULT_ENGINE_IDS.includes("curl-impersonate"), true);
  assert.deepEqual(
    [...QUERY_SOURCES.map((source) => source.id)].sort(),
    [...DISCOVERY_PROVIDER_IDS].sort(),
  );
});

test("stages stay honest when cheap fetch is enough", () => {
  const stages = buildResearchStages(
    facts({
      discovery: [
        {
          id: "wikipedia-pl",
          label: "Wikipedia PL",
          status: "live",
          hits: 2,
          durationMs: 10,
          message: "2 trafień",
        },
        {
          id: "duckduckgo",
          label: "DuckDuckGo HTML",
          status: "error",
          hits: 0,
          durationMs: 20,
          message: "HTTP 403",
        },
      ],
      hits: 2,
      pages: 1,
      cheapOk: 1,
      words: 400,
      fields: 3,
      hosts: 1,
      httpOk: 1,
      coverage: 1,
      covered: ["sztuczna", "inteligencja"],
    }),
  );
  assert.deepEqual(
    stages.map((stage) => stage.id),
    ["discovery", "fetch", "fallback", "deep", "extract", "verify"],
  );
  assert.equal(stages[0].status, "live");
  assert.match(stages[0].contribution, /DuckDuckGo/);
  assert.equal(stages[1].status, "local");
  assert.match(stages[1].provenance, /curl-impersonate/);
  assert.equal(stages[2].status, "skipped");
  assert.match(stages[2].reason ?? "", /wystarczyło|płatne/i);
  assert.equal(stages[3].status, "skipped");
  assert.equal(stages[4].status, "local");
  assert.match(stages[4].provenance, /MarkItDown|AutoScraper/);
  assert.equal(stages[5].status, "local");
  assert.match(stages[5].label, /Słowa/);
  assert.match(stages[5].contribution, /nie jest weryfikacja faktów/);
  assert.match(stages[5].output, /Nie zaimplementowano/);
  assert.match(stages[5].provenance, /grok-4\.3/);
});

test("a URL crawl does not pretend discovery or deep crawl ran", () => {
  const stages = buildResearchStages(
    facts({
      mode: "url",
      query: "https://example.com",
      discovery: [
        {
          id: "query-sources",
          label: "Źródła zapytań",
          status: "not_applicable",
          hits: 0,
          durationMs: 0,
          message: "Nie dotyczy",
        },
      ],
      hits: 1,
      pages: 1,
      cheapOk: 1,
      words: 20,
      httpOk: 1,
      coverage: 0.5,
      covered: ["example"],
      missing: ["com"],
    }),
  );
  assert.equal(stages[0].status, "not_applicable");
  assert.equal(stages[3].status, "not_applicable");
  assert.match(stages[3].provenance, /Crawlee/);
});


test("paid fallback is live only when a real call returned content", () => {
  const live = buildResearchStages(
    facts({
      pages: 1,
      cheapFail: 1,
      thinPages: 1,
      firecrawlCalls: 1,
      firecrawlOk: 1,
      words: 100,
      httpOk: 1,
      coverage: 0.5,
      covered: ["a"],
      missing: ["b"],
    }),
  );
  assert.equal(live.find((stage) => stage.id === "fallback")?.status, "live");
  const failed = buildResearchStages(
    facts({
      pages: 1,
      cheapFail: 1,
      thinPages: 1,
      browserCalls: 1,
      words: 0,
      coverage: 0,
    }),
  );
  assert.equal(failed.find((stage) => stage.id === "fallback")?.status, "error");
});
