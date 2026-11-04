import assert from "node:assert/strict";
import test from "node:test";
import { aggregateEngineRuns, summarizeRuns } from "./aggregate.ts";
import {
  adapterPosture,
  callBrowserUse,
  callCrawl4ai,
  callFirecrawl,
  parseBrowserUsePayload,
  parseCrawl4aiPayload,
  parseFirecrawlPayload,
} from "./adapters.ts";
import { parseArxiv, parseDuckDuckGoHtml } from "./discovery.ts";
import { ipIsPrivate, isPublicHttpUrl, looksBlocked, robotsDisallows } from "./http.ts";
import { resolveMode } from "./mode.ts";
import { canonicalUrl, dedupeHits, fuseHits, selectDiverse } from "./rank.ts";

test("canonical URL drops tracking params, www and hash", () => {
  const a = canonicalUrl("https://WWW.Example.com/docs/?utm_source=x&b=2&fbclid=abc&a=1#top");
  const b = canonicalUrl("https://example.com/docs?a=1&b=2");
  assert.equal(a, b);
  assert.equal(canonicalUrl("javascript:alert(1)"), null);
  assert.equal(canonicalUrl("http://127.0.0.1/secret"), "http://127.0.0.1/secret");
});

test("dedupe merges the same page", () => {
  const hits = dedupeHits([
    { title: "A", url: "https://ex.com/a?utm_medium=email", snippet: "one", source: "wikipedia-en" },
    { title: "A longer", url: "https://www.ex.com/a", snippet: "two", source: "duckduckgo" },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "https://ex.com/a");
});

test("fusion prefers a URL that several providers rank and keeps host diversity", () => {
  const fused = fuseHits(
    [
      {
        source: "wikipedia-pl",
        hits: [
          { title: "Sztuczna inteligencja", url: "https://pl.wikipedia.org/wiki/AI", snippet: "AI", source: "wikipedia-pl" },
          { title: "Uczenie", url: "https://pl.wikipedia.org/wiki/ML", snippet: "ml", source: "wikipedia-pl" },
          { title: "Sieć", url: "https://pl.wikipedia.org/wiki/Siec", snippet: "net", source: "wikipedia-pl" },
        ],
      },
      {
        source: "github",
        hits: [
          { title: "openai/gpt", url: "https://github.com/openai/gpt", snippet: "sztuczna inteligencja repo", source: "github" },
        ],
      },
      {
        source: "duckduckgo",
        hits: [
          { title: "Sztuczna inteligencja", url: "https://pl.wikipedia.org/wiki/AI?utm_source=ddg", snippet: "encyklopedia", source: "duckduckgo" },
          { title: "openai/gpt", url: "https://github.com/openai/gpt", snippet: "code", source: "duckduckgo" },
        ],
      },
    ],
    "sztuczna inteligencja",
  );
  assert.equal(fused[0].url, "https://pl.wikipedia.org/wiki/AI");
  assert.ok(fused[0].source.includes("wikipedia-pl"));
  assert.ok(fused[0].source.includes("duckduckgo"));
  const topHosts = fused.slice(0, 2).map((hit) => new URL(hit.url).hostname);
  assert.equal(new Set(topHosts).size, 2);
});

test("selectDiverse caps a single host", () => {
  const hits = [
    { url: "https://en.wikipedia.org/wiki/A" },
    { url: "https://en.wikipedia.org/wiki/B" },
    { url: "https://en.wikipedia.org/wiki/C" },
    { url: "https://news.ycombinator.com/item?id=1" },
    { url: "https://github.com/x/y" },
  ];
  const picked = selectDiverse(hits, 3, 1);
  assert.equal(picked.length, 3);
  const hosts = new Set(picked.map((hit) => new URL(hit.url).hostname.replace(/^www\./, "")));
  assert.ok(hosts.size >= 3);
});

test("private hosts and non-http URLs are rejected", () => {
  assert.equal(ipIsPrivate("127.0.0.1"), true);
  assert.equal(ipIsPrivate("10.1.2.3"), true);
  assert.equal(ipIsPrivate("192.168.0.5"), true);
  assert.equal(ipIsPrivate("169.254.169.254"), true);
  assert.equal(ipIsPrivate("8.8.8.8"), false);
  assert.equal(isPublicHttpUrl("http://127.0.0.1/latest/meta-data"), false);
  assert.equal(isPublicHttpUrl("http://localhost/admin"), false);
  assert.equal(isPublicHttpUrl("https://example.com/docs"), true);
  assert.equal(isPublicHttpUrl("file:///etc/passwd"), false);
  assert.equal(isPublicHttpUrl("https://user:pass@example.com/"), false);
});

test("robots.txt longest match and challenge detection", () => {
  const robots = `
User-agent: *
Disallow: /private
Allow: /private/ok
User-agent: spectra
Disallow: /secret
`;
  assert.equal(robotsDisallows(robots, "/private/docs", "spectra"), false);
  assert.equal(robotsDisallows(robots, "/private/docs", "otherbot"), true);
  assert.equal(robotsDisallows(robots, "/private/ok", "otherbot"), false);
  assert.equal(robotsDisallows(robots, "/secret", "spectra"), true);
  assert.equal(robotsDisallows(robots, "/secret", "otherbot"), false);
  assert.equal(looksBlocked(403, "<html>ok</html>"), true);
  assert.equal(looksBlocked(200, "<html>Just a moment while we check your browser</html>"), true);
  assert.equal(looksBlocked(200, "<html><title>Docs</title><p>hello</p></html>"), false);
});

test("DuckDuckGo HTML parser unwraps uddg and skips the search host", () => {
  const html = `
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fai&rut=1">Example AI</a>
      <div class="result__snippet">A public page about AI</div>
    </div>
    <div class="result">
      <a class="result__a" href="https://duckduckgo.com/settings">Settings</a>
      <div class="result__snippet">ignore</div>
    </div>
  `;
  const hits = parseDuckDuckGoHtml(html, "duckduckgo", 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "https://example.com/ai");
  assert.equal(hits[0].title, "Example AI");
});

test("arXiv atom entries become hits", () => {
  const xml = `<?xml version="1.0"?>
  <feed>
    <entry>
      <title>Attention Is All You Need</title>
      <id>https://arxiv.org/abs/1706.03762</id>
      <summary>Transformers.</summary>
    </entry>
  </feed>`;
  const hits = parseArxiv(xml, 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "https://arxiv.org/abs/1706.03762");
});

test("adapter posture never claims Scrapy, scrcpy or Crawlee are live", () => {
  for (const id of ["scrapy", "scrcpy", "crawlee"] as const) {
    const posture = adapterPosture(id, {});
    assert.equal(posture.status, "skipped");
    assert.match(posture.message, /Niedostępny|nie jest uruchamiana|nie działa|Wymaga|serverless/i);
  }
  assert.equal(adapterPosture("firecrawl", {}).status, "skipped");
  assert.match(adapterPosture("firecrawl", {}).message, /FIRECRAWL_API_KEY/);
  assert.equal(adapterPosture("firecrawl", { FIRECRAWL_API_KEY: "fc-test" }).status, "live");
  assert.equal(adapterPosture("curl-impersonate", {}).status, "degraded");
  assert.match(adapterPosture("curl-impersonate", {}).message, /JA3|nie działa/);
  assert.equal(adapterPosture("browser-use", {}).status, "skipped");
  assert.equal(adapterPosture("crawl4ai", { CRAWL4AI_BASE_URL: "https://crawl.example" }).status, "live");
});

test("aggregation does not promote skipped runs to live", () => {
  const merged = aggregateEngineRuns([
    { id: "scrapy", status: "skipped", durationMs: 0, message: "Niedostępny" },
    { id: "scrapy", status: "skipped", durationMs: 0, message: "Niedostępny" },
    { id: "firecrawl", status: "skipped", durationMs: 1, message: "brak klucza" },
    { id: "firecrawl", status: "live", durationMs: 20, message: "API", itemsFound: 3 },
    { id: "curl-impersonate", status: "degraded", durationMs: 10, message: "nagłówki" },
  ]);
  const byId = Object.fromEntries(merged.map((run) => [run.id, run]));
  assert.equal(byId.scrapy.status, "skipped");
  assert.equal(byId.firecrawl.status, "live");
  assert.equal(byId["curl-impersonate"].status, "degraded");
  assert.equal(summarizeRuns("scrcpy", []).status, "skipped");
});

test("Firecrawl client reports skipped-shaped errors and parses a real payload", async () => {
  const parsed = parseFirecrawlPayload({
    success: true,
    data: {
      markdown: "# Hello",
      html: "<h1>Hello</h1>",
      links: ["https://example.com/a", { url: "https://example.com/b" }],
      metadata: { title: "Hello", description: "World", sourceURL: "https://example.com", statusCode: 200 },
    },
  });
  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;
  assert.equal(parsed.title, "Hello");
  assert.equal(parsed.links.length, 2);
  assert.equal(parsed.fields[0].source, "firecrawl");

  let called = 0;
  const missing = await callFirecrawl("https://example.com", {
    apiKey: "fc-test",
    fetchImpl: async () => {
      called += 1;
      return new Response(JSON.stringify({ success: false, error: "nope" }), { status: 200 });
    },
  });
  assert.equal(called, 1);
  assert.deepEqual(missing, { error: "nope" });

  const denied = await callFirecrawl("https://example.com", {
    apiKey: "fc-test",
    fetchImpl: async () => new Response("no credits", { status: 402 }),
  });
  assert.equal("error" in denied, true);
});

test("Browser Use and Crawl4AI clients hit the documented endpoints", async () => {
  assert.deepEqual(parseBrowserUsePayload({ error: "bad key" }, "https://example.com"), { error: "bad key" });
  const page = parseBrowserUsePayload(
    { status_code: 200, body: "<p>hi</p>", final_url: "https://example.com/final" },
    "https://example.com",
  );
  assert.ok(!("error" in page));

  let browserUrl = "";
  const result = await callBrowserUse("https://example.com/docs", {
    apiKey: "bu_test",
    sessionId: "sess-1",
    serviceUrl: "https://fetch.test",
    fetchImpl: async (input, init) => {
      browserUrl = String(input);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.url, "https://example.com/docs");
      assert.equal(body.output_format, "simplified");
      assert.equal((init?.headers as Record<string, string>)["X-Browser-Use-API-Key"], "bu_test");
      return new Response(JSON.stringify({ status_code: 200, body: "<article>ok</article>", final_url: "https://example.com/docs" }));
    },
  });
  assert.equal(browserUrl, "https://fetch.test/fetch");
  assert.ok(!("error" in result));

  const md = parseCrawl4aiPayload({ success: true, markdown: "# From crawl4ai" });
  assert.deepEqual(md, { markdown: "# From crawl4ai" });

  let crawlUrl = "";
  const remote = await callCrawl4ai("https://example.com", {
    env: { CRAWL4AI_BASE_URL: "https://crawl.internal", CRAWL4AI_API_TOKEN: "tok" },
    fetchImpl: async (input, init) => {
      crawlUrl = String(input);
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tok");
      return new Response(JSON.stringify({ markdown: "# Remote", success: true }));
    },
  });
  assert.equal(crawlUrl, "https://crawl.internal/md");
  assert.deepEqual(remote, { markdown: "# Remote" });

  const noKey = await callCrawl4ai("https://example.com", {
    env: {},
    fetchImpl: async () => {
      throw new Error("should not be called");
    },
  });
  assert.deepEqual(noKey, { error: "Brak CRAWL4AI_API_KEY i CRAWL4AI_BASE_URL" });
});

test("search modes stay Auto / Szukaj / URL / Deep", () => {
  assert.equal(resolveMode("https://example.com", "auto"), "url");
  assert.equal(resolveMode("sztuczna inteligencja", "auto"), "search");
  assert.equal(resolveMode("https://example.com", "search"), "search");
  assert.equal(resolveMode("react", "deep"), "deep");
  assert.equal(resolveMode("react", "url"), "url");
});
