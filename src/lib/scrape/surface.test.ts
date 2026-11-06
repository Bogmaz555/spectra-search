import assert from "node:assert/strict";
import test from "node:test";
import { runSpectra } from "./pipeline.ts";

const html = (title: string, body: string, href = "") =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="Opis ${title}."></head><body><article><h1>${title}</h1><p>${body}</p>${href ? `<a href="${href}">dalej</a>` : ""}</article></body></html>`;

const long = "sztuczna inteligencja ".repeat(80);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function page(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

test("text query keeps working sources when DuckDuckGo is blocked and does not call SerpAPI", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("serpapi.com") || url.includes("api.firecrawl.dev") || url.includes("browser-use")) {
      throw new Error(`unexpected paid call ${url}`);
    }
    if (url.includes("duckduckgo.com")) return page("blocked", 403);
    if (url.includes("pl.wikipedia.org/w/api.php")) {
      return json({
        query: { search: [{ title: "Sztuczna inteligencja", snippet: "dziedzina <b>informatyki</b>" }] },
      });
    }
    if (url.includes("robots.txt")) return page("User-agent: *\nAllow: /\n");
    if (
      url.includes("wikipedia.org/w/api.php") ||
      url.includes("wikidata.org") ||
      url.includes("api.github.com") ||
      url.includes("hn.algolia.com") ||
      url.includes("api.stackexchange.com") ||
      url.includes("export.arxiv.org")
    ) {
      return json({});
    }
    return page(html("Sztuczna inteligencja", long));
  };

  const result = await runSpectra(
    { query: "sztuczna inteligencja", mode: "search", maxPages: 1, useAi: false },
    { env: {}, fetchImpl },
  );

  const ddg = result.discovery.find((run) => run.id === "duckduckgo");
  const wiki = result.discovery.find((run) => run.id === "wikipedia-pl");
  assert.equal(ddg?.status, "error");
  assert.match(ddg?.message ?? "", /403/);
  assert.match(ddg?.message ?? "", /Wikipedia/);
  assert.equal(wiki?.status, "live");
  assert.ok((wiki?.hits ?? 0) > 0);
  assert.equal(result.engines.some((engine) => engine.id === "scrcpy"), false);
  assert.equal(result.engines.some((engine) => engine.id === "scrapy"), false);
  assert.equal(result.engines.find((engine) => engine.id === "curl-impersonate")?.status, "local");
  assert.equal(result.stages.length, 6);
  assert.equal(result.stages[0]?.status, "live");
  assert.equal(result.stages[1]?.status, "local");
  assert.equal(result.stages[2]?.status, "skipped");
  assert.ok(result.sources.length >= 1);
  assert.equal(calls.some((url) => url.includes("serpapi.com")), false);
  const words = result.effectiveness.factors.find((factor) => factor.label === "Słowa zapytania");
  assert.equal(words?.kind, "note");
  assert.match(words?.detail ?? "", /nie weryfikacja faktów/);
  assert.match(result.effectiveness.disclaimer, /Nie mierzy prawdy/);
  assert.match(result.stages.find((stage) => stage.id === "verify")?.output ?? "", /Nie zaimplementowano/);
});

test("a rich page does not spend Firecrawl or Crawl4AI even when keys are set", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("robots.txt")) return page("User-agent: *\nAllow: /\n");
    if (url.includes("api.firecrawl.dev") || url.includes("crawl4ai") || url.includes("browser-use")) {
      return json({ error: "should not be called" }, 500);
    }
    return page(html("Dokumentacja", long));
  };
  const result = await runSpectra(
    { query: "https://example.com/docs", mode: "url", maxPages: 1, useAi: false },
    {
      env: {
        FIRECRAWL_API_KEY: "fc-test",
        CRAWL4AI_API_KEY: "c4-test",
        BROWSER_USE_API_KEY: "bu-test",
      },
      fetchImpl,
    },
  );
  assert.equal(calls.some((url) => url.includes("api.firecrawl.dev")), false);
  assert.equal(calls.some((url) => url.includes("crawl4ai")), false);
  assert.equal(calls.some((url) => url.includes("browser-use")), false);
  assert.equal(result.stages.find((stage) => stage.id === "discovery")?.status, "not_applicable");
  assert.equal(result.stages.find((stage) => stage.id === "fallback")?.status, "skipped");
  assert.equal(result.stages.find((stage) => stage.id === "deep")?.status, "not_applicable");
  assert.match(
    result.engines.find((engine) => engine.id === "firecrawl")?.message ?? "",
    /wystarczyło/,
  );

  const shortCalls: string[] = [];
  const shortFetch: typeof fetch = async (input) => {
    const url = String(input);
    shortCalls.push(url);
    if (url.includes("robots.txt")) return page("User-agent: *\nAllow: /\n");
    if (url.includes("firecrawl") || url.includes("crawl4ai") || url.includes("browser-use")) {
      throw new Error(`paid call for a short healthy page ${url}`);
    }
    return page(html("Example Domain", "This domain is for use in illustrative examples in documents."));
  };
  const short = await runSpectra(
    { query: "https://example.com", mode: "url", maxPages: 1, useAi: false },
    { env: { FIRECRAWL_API_KEY: "fc-test", CRAWL4AI_API_KEY: "c4-test" }, fetchImpl: shortFetch },
  );
  assert.equal(shortCalls.some((url) => url.includes("firecrawl") || url.includes("crawl4ai")), false);
  assert.equal(short.stages.find((stage) => stage.id === "fallback")?.status, "skipped");
  assert.match(short.stages.find((stage) => stage.id === "fallback")?.reason ?? "", /wystarczyło/);
});

test("a blocked page may call Firecrawl once and does not also call Browser Use when Firecrawl fills the page", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("robots.txt")) return page("User-agent: *\nAllow: /\n");
    if (url.includes("api.firecrawl.dev")) {
      return json({
        success: true,
        data: {
          markdown: `# Zablokowana\n\n${long}`,
          html: html("Zablokowana", long),
          links: [],
          metadata: { title: "Zablokowana", description: "po fallbacku", sourceURL: url, statusCode: 200 },
        },
      });
    }
    if (url.includes("browser-use") || url.includes("crawl4ai")) {
      throw new Error(`redundant fallback ${url}`);
    }
    return page("attention required", 403);
  };
  const result = await runSpectra(
    { query: "https://example.com/blocked", mode: "url", maxPages: 1, useAi: false },
    { env: { FIRECRAWL_API_KEY: "fc-test", BROWSER_USE_API_KEY: "bu-test" }, fetchImpl },
  );
  assert.equal(calls.filter((line) => line.includes("api.firecrawl.dev")).length, 1);
  assert.equal(calls.some((line) => line.includes("browser-use")), false);
  assert.equal(result.stages.find((stage) => stage.id === "fallback")?.status, "live");
  assert.equal(result.engines.find((engine) => engine.id === "firecrawl")?.status, "live");
  assert.match(result.engines.find((engine) => engine.id === "browser-use")?.message ?? "", /nie był wołany/);
});

test("private URLs are not fetched", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return page("no");
  };
  const result = await runSpectra(
    { query: "http://127.0.0.1/latest/meta-data", mode: "url", maxPages: 1, useAi: false },
    { env: {}, fetchImpl },
  );
  assert.equal(calls, 0);
  assert.equal(result.engines.find((engine) => engine.id === "curl-impersonate")?.status, "error");
  assert.match(result.engines.find((engine) => engine.id === "curl-impersonate")?.message ?? "", /prywatny|odrzucony/i);
});

test("CapEx treats an empty RSS body as skipped and a dead RSS as an error", async () => {
  const krsBody = {
    odpis: {
      dane: {
        dzial1: {
          danePodmiotu: {
            nazwa: "FIRMA Y SPOLKA",
            identyfikatory: { nip: "7740001454" },
          },
        },
        dzial2: {
          reprezentacja: {
            sposobReprezentacji: "jednoosobowo",
            sklad: [
              {
                imiona: { imie: "JAN" },
                nazwisko: { nazwiskoICzlon: "KOWALSKI" },
                funkcjaWOrganie: "PREZES ZARZADU",
              },
            ],
          },
        },
      },
    },
  };
  const handler = (newsStatus: number): typeof fetch => async (input) => {
    const url = String(input);
    if (url.includes("serpapi.com")) throw new Error("serpapi");
    if (url.includes("127.0.0.1")) throw new Error("ssrf");
    if (url.includes("news.google.com")) {
      return newsStatus === 200
        ? new Response("<rss><channel></channel></rss>", {
            status: 200,
            headers: { "content-type": "application/rss+xml" },
          })
        : page("down", newsStatus);
    }
    if (url.includes("api-krs.ms.gov.pl")) return json(krsBody);
    if (url.includes("duckduckgo.com")) return page("no", 403);
    if (url.includes("robots.txt")) return page("User-agent: *\nAllow: /\n");
    if (url.includes("/aktualnosci")) return page(html("Aktualnosci", long));
    if (url.includes("example.com")) return page(html("Firma Y", long));
    if (url.includes("api.php") || url.includes("api.github") || url.includes("algolia") || url.includes("stackexchange") || url.includes("arxiv") || url.includes("wikidata")) {
      return json({});
    }
    return page(html("Inna", long));
  };

  const ok = await runSpectra(
    {
      query: "Firma Y KRS 0000123456 https://example.com",
      mode: "capex",
      maxPages: 2,
      useAi: false,
    },
    { env: {}, fetchImpl: handler(200) },
  );
  assert.equal(ok.discovery.find((run) => run.id === "krs")?.status, "live");
  assert.equal(ok.discovery.find((run) => run.id === "google-news")?.status, "skipped");
  assert.match(ok.discovery.find((run) => run.id === "google-news")?.message ?? "", /pusto/);
  assert.equal(ok.discovery.find((run) => run.id === "company-paths")?.status, "live");
  assert.equal(ok.engines.some((engine) => engine.id === "scrcpy"), false);

  const down = await runSpectra(
    { query: "Firma Z", mode: "capex", maxPages: 1, useAi: false },
    { env: {}, fetchImpl: handler(503) },
  );
  assert.equal(down.discovery.find((run) => run.id === "google-news")?.status, "error");
  assert.equal(down.discovery.find((run) => run.id === "krs")?.status, "skipped");
  assert.match(down.discovery.find((run) => run.id === "krs")?.message ?? "", /Nie dotyczy/);
});
