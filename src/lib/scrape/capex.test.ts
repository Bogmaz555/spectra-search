import assert from "node:assert/strict";
import test from "node:test";
import { capexQueries, parseCapexInput, parseGoogleNewsRss } from "./capex.ts";
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
