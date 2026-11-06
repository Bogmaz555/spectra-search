import assert from "node:assert/strict";
import test from "node:test";
import { capexDeepLink, readCapexDeepLink } from "./capex-link.ts";
import {
  acceptCompanyPath,
  applyRegistryToCard,
  capexCrawlPlan,
  capexQueries,
  capexSiteQueries,
  companyOrigins,
  emptyCapexCard,
  isGoogleNewsHost,
  parseBatchexecutePublisherUrl,
  parseCapexInput,
  parseGoogleNewsRss,
  parseGoogleNewsSignature,
  probeCompanyPaths,
  resolveCapexNewsHits,
  searchCapexNews,
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
    [
      "wrb.fr",
      "Fbv4je",
      JSON.stringify(["garturlres", "https://example.com/artykul", 1]),
      null,
      null,
      null,
      "generic",
    ],
  ])}`;
  assert.equal(parseBatchexecutePublisherUrl(body), "https://example.com/artykul");
  assert.equal(parseBatchexecutePublisherUrl("not-json"), null);
});

test("resolveCapexNewsHits swaps shells for publisher URLs and keeps failures", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rss/articles/")) {
      return new Response(
        `<div data-n-a-id="ART_ID" data-n-a-ts="1700000000" data-n-a-sg="SIG_1"></div>`,
        {
          status: 200,
        },
      );
    }
    if (url.includes("batchexecute")) {
      const body = String(init?.body ?? "");
      assert.match(body, /ART_ID/);
      assert.match(body, /SIG_1/);
      const payload = JSON.stringify([
        [
          "wrb.fr",
          "Fbv4je",
          JSON.stringify(["garturlres", "https://wydawca.example/inwestycja", 1]),
          null,
          null,
          null,
          "generic",
        ],
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

test("capex input lifts KRS and NIP out of the company name", () => {
  const labeled = parseCapexInput("Mlekovita KRS 28860 NIP 774-000-14-54 https://firma.pl/o-nas");
  assert.equal(labeled.company, "Mlekovita");
  assert.equal(labeled.krs, "0000028860");
  assert.equal(labeled.nip, "7740001454");
  assert.deepEqual(labeled.urls, ["https://firma.pl/o-nas"]);

  const bareKrs = parseCapexInput("0000123456");
  assert.equal(bareKrs.company, "");
  assert.equal(bareKrs.krs, "0000123456");

  const bareNip = parseCapexInput("7740001454");
  assert.equal(bareNip.nip, "7740001454");
  assert.equal(bareNip.krs, undefined);
});

test("trade-press site templates stay a short list", () => {
  const sites = capexSiteQueries("Firma X");
  const hosts = sites.map((site) => site.host);
  assert.ok(hosts.length >= 4 && hosts.length <= 6);
  assert.ok(hosts.includes("wnp.pl"));
  assert.ok(hosts.includes("pb.pl"));
  assert.ok(hosts.some((host) => host.includes("automatyk")));
  assert.ok(hosts.some((host) => host.includes("opakow")));
  assert.equal(capexSiteQueries("").length, 0);
  assert.match(sites[0]?.query ?? "", /^site:wnp\.pl Firma X$/);
});

test("company origin prefers the firm host and skips trade press", () => {
  assert.deepEqual(
    companyOrigins(
      "Mlekovita",
      [],
      ["https://www.wnp.pl/art", "https://mlekovita.com.pl/news", "https://pb.pl/x"],
    ),
    ["https://mlekovita.com.pl"],
  );
  assert.deepEqual(companyOrigins("Mlekovita", ["https://firma.pl/o-nas"], []), [
    "https://firma.pl",
  ]);
  assert.deepEqual(
    companyOrigins("Mlekovita", ["https://wnp.pl/artykul"], ["https://www.mlekovita.pl/a"]),
    ["https://mlekovita.pl"],
  );
});

test("company paths keep HTTP 200 on the same host and drop the homepage", () => {
  assert.equal(
    acceptCompanyPath("https://firma.pl", "https://firma.pl/aktualnosci"),
    "https://firma.pl/aktualnosci",
  );
  assert.equal(acceptCompanyPath("https://firma.pl", "https://firma.pl/"), null);
  assert.equal(acceptCompanyPath("https://firma.pl", "https://inne.pl/aktualnosci"), null);
  assert.equal(acceptCompanyPath("https://wnp.pl", "https://wnp.pl/aktualnosci"), null);
});

test("probeCompanyPaths queues only the paths that return 200", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/kontakt")) return new Response("no", { status: 404 });
    if (url.endsWith("/inwestycje")) {
      const res = new Response("home", { status: 200 });
      Object.defineProperty(res, "url", { value: "https://firma.pl/" });
      return res;
    }
    return new Response("ok", { status: 200 });
  };
  const queued = await probeCompanyPaths("https://firma.pl", { fetchImpl });
  assert.ok(queued.includes("https://firma.pl/aktualnosci"));
  assert.ok(queued.includes("https://firma.pl/o-nas"));
  assert.equal(queued.includes("https://firma.pl/kontakt"), false);
  assert.equal(queued.includes("https://firma.pl/inwestycje"), false);
  assert.equal(queued.includes("https://firma.pl/"), false);
});

test("crawl plan puts company paths ahead of news and respects the page cap", () => {
  const plan = capexCrawlPlan({
    direct: ["https://firma.pl/start"],
    companyPaths: [
      "https://firma.pl/aktualnosci",
      "https://firma.pl/inwestycje",
      "https://firma.pl/o-nas",
      "https://firma.pl/kontakt",
    ],
    news: ["https://wydawca.example/a", "https://wydawca.example/b"],
    maxPages: 4,
  });
  assert.deepEqual(plan, [
    "https://firma.pl/start",
    "https://firma.pl/aktualnosci",
    "https://firma.pl/inwestycje",
    "https://firma.pl/o-nas",
  ]);
});

test("capex deep link round-trips mode and query", () => {
  const href = capexDeepLink("Mlekovita KRS 0000123456");
  const params = new URLSearchParams(href.slice(2));
  assert.equal(params.get("mode"), "capex");
  assert.equal(
    readCapexDeepLink({ mode: params.get("mode"), q: params.get("q") }),
    "Mlekovita KRS 0000123456",
  );
  assert.equal(readCapexDeepLink({ mode: "search", q: "Mlekovita" }), null);
});

test("registry people land on the card and open zbadaj firmę", () => {
  const card = applyRegistryToCard(
    emptyCapexCard("Mlekovita"),
    {
      krs: "0000123456",
      nip: "7740001454",
      name: "MLEKOVITA SPÓŁKA",
      sourceUrl: "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000123456?rejestr=P&format=json",
      sourceTitle: "KRS 0000123456",
      people: [{ name: "JAN KOWALSKI", role: "PREZES ZARZĄDU", kind: "zarzad" }],
    },
    "Mlekovita",
  );
  assert.equal(card.people.length, 1);
  assert.equal(card.checklist.find((item) => item.item.startsWith("Osoba decyzyjna"))?.done, true);
  assert.equal(card.sources[0]?.url.includes("api-krs.ms.gov.pl"), true);
  const params = new URLSearchParams(card.investigateUrl.slice(2));
  assert.equal(params.get("mode"), "capex");
  assert.match(params.get("q") ?? "", /Mlekovita/);
  assert.match(params.get("q") ?? "", /0000123456/);
});

test("press site templates are actually requested", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    return new Response("<rss><channel></channel></rss>", { status: 200 });
  };
  const news = await searchCapexNews("Firma X", { fetchImpl });
  const decoded = urls.map((url) => decodeURIComponent(url));
  assert.equal(news.pressQueries, capexSiteQueries("Firma X").length);
  assert.ok(decoded.some((url) => url.includes("site:wnp.pl Firma X")));
  assert.ok(decoded.some((url) => url.includes("site:pb.pl Firma X")));
  assert.ok(decoded.some((url) => url.includes("site:opakowanie.com.pl Firma X")));
  assert.equal(news.investment.length, 0);
  assert.equal(news.press.length, 0);
  assert.equal(news.investmentFailed, 0);
  assert.equal(news.pressFailed, 0);
});
