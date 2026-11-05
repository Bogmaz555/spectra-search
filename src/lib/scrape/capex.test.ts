import assert from "node:assert/strict";
import test from "node:test";
import {
  capexQueries,
  isGoogleNewsHost,
  parseBatchexecutePublisherUrl,
  parseCapexInput,
  parseGoogleNewsRss,
  parseGoogleNewsSignature,
  resolveCapexNewsHits,
} from "./capex.ts";
import { resolveMode } from "./mode.ts";

test("capex input splits company name from URLs", () => {
  const r = parseCapexInput("Mlekovita https://mlekovita.com.pl/aktualnosci, example.org/news");
  assert.equal(r.company, "Mlekovita");
  assert.equal(r.urls.length, 2);
});

test("capex templates are PL investment queries", () => {
  const q = capexQueries("Firma X");
  assert.ok(q.includes("Firma X nowa hala"));
  assert.equal(capexQueries("").length, 0);
});

test("Google News RSS items become hits", () => {
  const xml = `<rss><channel><item><title>Firma X buduje halę</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><source url="https://x.pl">Portal</source></item></channel></rss>`;
  const hits = parseGoogleNewsRss(xml, 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source, "google-news");
  assert.match(hits[0].snippet, /Portal/);
});

test("capex mode is resolved explicitly", () => {
  assert.equal(resolveMode("Firma X", "capex"), "capex");
});

test("Google News shells are recognized and publisher URLs are decoded", () => {
  assert.equal(isGoogleNewsHost("https://news.google.com/rss/articles/abc"), true);
  assert.equal(isGoogleNewsHost("https://example.com/news"), false);
  const html = `<div data-n-a-id="ART_ID" data-n-a-ts="1700000000" data-n-a-sg="SIG_1"></div>`;
  assert.deepEqual(parseGoogleNewsSignature(html), {
    id: "ART_ID",
    timestamp: "1700000000",
    signature: "SIG_1",
  });
  const body = `)]}'\n${JSON.stringify([
    ["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", "https://example.com/artykul", 1]), null, null, null, "generic"],
  ])}`;
  assert.equal(parseBatchexecutePublisherUrl(body), "https://example.com/artykul");
  assert.equal(parseBatchexecutePublisherUrl("not-json"), null);
});

test("resolveCapexNewsHits swaps shells for publisher URLs and keeps failures", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rss/articles/")) {
      return new Response(`<div data-n-a-id="ART_ID" data-n-a-ts="1700000000" data-n-a-sg="SIG_1"></div>`, {
        status: 200,
      });
    }
    if (url.includes("batchexecute")) {
      const body = String(init?.body ?? "");
      assert.match(body, /ART_ID/);
      assert.match(body, /SIG_1/);
      const payload = JSON.stringify([
        ["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", "https://wydawca.example/inwestycja", 1]), null, null, null, "generic"],
      ]);
      return new Response(`)]}'\n${payload}`, { status: 200 });
    }
    return new Response("no", { status: 404 });
  };
  const hits = await resolveCapexNewsHits(
    [
      {
        title: "Firma buduje halę",
        url: "https://news.google.com/rss/articles/ART_ID",
        snippet: "Portal",
        source: "google-news",
      },
      {
        title: "Bez podpisu",
        url: "https://news.google.com/rss/articles/MISSING",
        snippet: "Portal",
        source: "google-news",
      },
    ],
    {
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/MISSING")) return new Response("<html></html>", { status: 200 });
        return fetchImpl(input, init);
      },
      limit: 8,
      concurrency: 2,
    },
  );
  assert.equal(hits[0]?.url, "https://wydawca.example/inwestycja");
  assert.equal(hits[1]?.url, "https://news.google.com/rss/articles/MISSING");
});
