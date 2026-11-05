import { ENGINES, type EngineId } from "../engines.ts";
import { isUrl, normalizeUrl } from "../utils.ts";
import { getXaiStatus, scoreEffectiveness, synthesizeWithGrok } from "../xai.ts";
import {
  adapterPosture,
  callBrowserUse,
  callCrawl4ai,
  callFirecrawl,
  envHas,
  firecrawlLinks,
  mkRun,
} from "./adapters.ts";
import { summarizeRuns } from "./aggregate.ts";
import { runDiscovery } from "./discovery.ts";
import {
  extractDocument,
  htmlToMarkdown,
  linksFromMarkdown,
  normalizeMarkdown,
  visibleTextLength,
} from "./extract.ts";
import {
  allowedByRobots,
  isPublicHttpUrl,
  isPublicHttpUrlResolved,
  resilientGet,
  type HttpResult,
} from "./http.ts";
import { clampPages, LIMITS, synthesisAbortMs } from "./limits.ts";
import { resolveMode } from "./mode.ts";
import { canonicalUrl, selectDiverse } from "./rank.ts";
import type {
  DiscoveryRun,
  EngineRun,
  MobileInsight,
  SearchHit,
  SearchMode,
  SourceResult,
  SpectraRequest,
  SpectraResult,
} from "./types.ts";

const SKIP_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|mp4|mp3|zip|gz|rar)(\?|$)/i;

type Env = Record<string, string | undefined>;

interface ScrapeCtx {
  enabled: Set<EngineId>;
  env: Env;
  fetchImpl: typeof fetch;
  deadline: number;
  sessionId: string;
  remote: { firecrawl: number; browser: number; crawl4ai: number };
}

function emptyMobile(): MobileInsight {
  return { hasAppLinks: false, isMobileOptimized: false };
}

function blankSource(url: string, engines: EngineRun[], title: string, description: string): SourceResult {
  return {
    url,
    title,
    description,
    markdown: "",
    textPreview: "",
    links: [],
    media: [],
    structured: [],
    patterns: [],
    interactive: [],
    mobile: emptyMobile(),
    wordCount: 0,
    statusCode: 0,
    contentType: "",
    engines,
    fetchedAt: new Date().toISOString(),
  };
}

function on(ctx: ScrapeCtx, id: EngineId): boolean {
  return ctx.enabled.has(id);
}

function timeLeft(ctx: ScrapeCtx): number {
  return ctx.deadline - Date.now();
}

async function scrapeOne(rawUrl: string, ctx: ScrapeCtx): Promise<SourceResult> {
  const started = new Date().toISOString();
  const runs: EngineRun[] = [];
  const url = canonicalUrl(rawUrl) ?? rawUrl;

  if (timeLeft(ctx) < 2_000) {
    runs.push(mkRun("curl-impersonate", "error", 0, "Budżet czasu funkcji wyczerpany — strona pominięta"));
    return { ...blankSource(url, runs, "Pominięto", "Budżet czasu"), fetchedAt: started };
  }
  if (!(await isPublicHttpUrlResolved(url))) {
    runs.push(mkRun("curl-impersonate", "error", 0, "URL odrzucony (adres prywatny, lokalny albo nie-HTTP)"));
    return { ...blankSource(url, runs, "Odrzucony URL", "Adres nie jest publicznym HTTP(S)"), fetchedAt: started };
  }
  if (!(await allowedByRobots(url, ctx.fetchImpl))) {
    if (on(ctx, "curl-impersonate")) {
      runs.push(mkRun("curl-impersonate", "skipped", 0, "robots.txt zabrania tej ścieżki"));
    }
    if (on(ctx, "firecrawl")) {
      runs.push(mkRun("firecrawl", "skipped", 0, "robots.txt — Firecrawl nie jest wołany"));
    }
    if (on(ctx, "browser-use")) {
      runs.push(mkRun("browser-use", "skipped", 0, "robots.txt — Browser Use nie omija zakazu"));
    }
    return {
      ...blankSource(url, runs, "Zablokowane przez robots.txt", "Ścieżka jest wyłączona w robots.txt"),
      fetchedAt: started,
    };
  }

  let html = "";
  let markdown = "";
  let finalUrl = url;
  let statusCode = 0;
  let contentType = "";
  let title = "";
  let description = "";
  let firecrawlFields: SourceResult["structured"] = [];
  let firecrawlLinkList: string[] = [];
  let fromFirecrawl = false;

  const firecrawlKey = ctx.env.FIRECRAWL_API_KEY?.trim();
  if (on(ctx, "firecrawl")) {
    if (!firecrawlKey) {
      runs.push(mkRun("firecrawl", "skipped", 0, adapterPosture("firecrawl", ctx.env).message));
    } else if (!isPublicHttpUrl(url)) {
      runs.push(mkRun("firecrawl", "skipped", 0, "URL odrzucony przed wywołaniem Firecrawl"));
    } else if (ctx.remote.firecrawl <= 0) {
      runs.push(mkRun("firecrawl", "skipped", 0, "Limit wywołań Firecrawl na to zapytanie został wyczerpany"));
    } else if (timeLeft(ctx) < 3_000) {
      runs.push(mkRun("firecrawl", "skipped", 0, "Za mało czasu na Firecrawl"));
    } else {
      ctx.remote.firecrawl -= 1;
      const t0 = Date.now();
      const page = await callFirecrawl(url, {
        apiKey: firecrawlKey,
        fetchImpl: ctx.fetchImpl,
        timeoutMs: Math.min(LIMITS.firecrawlTimeoutMs, timeLeft(ctx) - 500),
      });
      if ("error" in page) {
        runs.push(mkRun("firecrawl", "error", Date.now() - t0, page.error));
      } else {
        fromFirecrawl = true;
        html = page.html;
        markdown = page.markdown;
        title = page.title;
        description = page.description;
        finalUrl = canonicalUrl(page.sourceUrl) ?? url;
        statusCode = page.statusCode || 200;
        contentType = html ? "text/html" : "text/markdown";
        firecrawlFields = page.fields;
        firecrawlLinkList = page.links;
        runs.push(
          mkRun(
            "firecrawl",
            "live",
            Date.now() - t0,
            `Firecrawl /v1/scrape · ${page.fields.length} pól · ${page.links.length} linków`,
            page.fields.length,
          ),
        );
      }
    }
  }

  let fetched: HttpResult | null = null;
  if (!fromFirecrawl) {
    fetched = await resilientGet(url, {
      fetchImpl: ctx.fetchImpl,
      timeoutMs: Math.min(LIMITS.fetchTimeoutMs, Math.max(2_000, timeLeft(ctx) - 500)),
      respectRobots: true,
    });
    finalUrl = canonicalUrl(fetched.url) ?? fetched.url;
    statusCode = fetched.statusCode;
    contentType = fetched.contentType;
    html = fetched.body;
  }

  if (on(ctx, "curl-impersonate")) {
    if (fromFirecrawl) {
      runs.push(mkRun("curl-impersonate", "skipped", 0, "Pobranie wykonał Firecrawl — lokalny fetch nie był wołany"));
    } else if (!fetched) {
      runs.push(mkRun("curl-impersonate", "skipped", 0, "Fetch wyłączony"));
    } else if (fetched.robotsBlocked) {
      runs.push(mkRun("curl-impersonate", "skipped", fetched.durationMs, fetched.error || "robots.txt"));
    } else if (fetched.ok) {
      runs.push(
        mkRun(
          "curl-impersonate",
          "degraded",
          fetched.durationMs,
          `HTTP ${fetched.statusCode} · ${Math.max(1, Math.round(fetched.body.length / 1024))} KB · nagłówki Chrome, bez TLS/JA3 curl-impersonate`,
          1,
        ),
      );
    } else {
      runs.push(
        mkRun(
          "curl-impersonate",
          "error",
          fetched.durationMs,
          fetched.error || `HTTP ${fetched.statusCode || "—"}`,
        ),
      );
    }
  }

  if (on(ctx, "scrapling")) {
    if (fromFirecrawl) {
      runs.push(mkRun("scrapling", "skipped", 0, "Stronę pobrał Firecrawl — lokalny retry nie był potrzebny"));
    } else if (!fetched) {
      runs.push(mkRun("scrapling", "skipped", 0, "Brak odpowiedzi do oceny"));
    } else if (fetched.robotsBlocked) {
      runs.push(mkRun("scrapling", "skipped", 0, "robots.txt — bez obchodzenia zakazu"));
    } else if (fetched.attempts > 1) {
      runs.push(
        mkRun(
          "scrapling",
          "degraded",
          fetched.durationMs,
          `Retry (${fetched.attempts} próby)${fetched.blocked ? " · nadal wygląda na blokadę" : ""}. To nie jest biblioteka Scrapling.`,
          fetched.attempts,
        ),
      );
    } else {
      runs.push(
        mkRun(
          "scrapling",
          "degraded",
          1,
          fetched.blocked
            ? "Wykryto blokadę (CAPTCHA/403/429). Lokalna heurystyka, nie Scrapling."
            : "Brak śladów blokady. Detekcja lokalna, nie biblioteka Scrapling.",
        ),
      );
    }
  }

  const thin =
    !fromFirecrawl &&
    !!fetched &&
    !fetched.robotsBlocked &&
    (fetched.blocked || !fetched.ok || visibleTextLength(html) < 280);
  const browserKey = ctx.env.BROWSER_USE_API_KEY?.trim();
  if (on(ctx, "browser-use")) {
    if (!browserKey) {
      runs.push(mkRun("browser-use", "skipped", 0, adapterPosture("browser-use", ctx.env).message));
    } else if (fromFirecrawl) {
      runs.push(mkRun("browser-use", "skipped", 0, "Firecrawl zwrócił treść — Browser Use nie był wołany"));
    } else if (fetched?.robotsBlocked) {
      runs.push(mkRun("browser-use", "skipped", 0, "robots.txt zabrania ścieżki — Browser Use jej nie omija"));
    } else if (!thin) {
      runs.push(
        mkRun(
          "browser-use",
          "skipped",
          0,
          "Klucz jest ustawiony. Lokalny fetch wystarczył — Browser Use wołany tylko przy blokadzie albo pustej stronie.",
        ),
      );
    } else if (ctx.remote.browser <= 0) {
      runs.push(mkRun("browser-use", "skipped", 0, "Limit Browser Use na to zapytanie (2) został wyczerpany"));
    } else if (timeLeft(ctx) < 3_000) {
      runs.push(mkRun("browser-use", "skipped", 0, "Za mało czasu na Browser Use"));
    } else {
      ctx.remote.browser -= 1;
      const t0 = Date.now();
      const page = await callBrowserUse(url, {
        apiKey: browserKey,
        sessionId: ctx.sessionId,
        fetchImpl: ctx.fetchImpl,
        timeoutMs: Math.min(LIMITS.browserUseTimeoutMs, timeLeft(ctx) - 500),
        serviceUrl: ctx.env.FETCH_USE_URL,
      });
      if ("error" in page) {
        runs.push(mkRun("browser-use", "error", Date.now() - t0, page.error));
      } else {
        html = page.body;
        finalUrl = canonicalUrl(page.finalUrl) ?? page.finalUrl;
        statusCode = page.statusCode || statusCode;
        contentType = page.contentType || "text/html";
        markdown = "";
        runs.push(
          mkRun(
            "browser-use",
            "live",
            Date.now() - t0,
            `fetch.browser-use.com · HTTP ${page.statusCode || "—"} · uproszczony HTML`,
            1,
          ),
        );
      }
    }
  }

  const extracted = html ? extractDocument(html, finalUrl) : null;
  if (extracted) {
    title = extracted.title || title;
    description = extracted.description || description;
  }
  if (!title) title = finalUrl;

  let links = extracted?.links ?? [];
  if (!links.length && firecrawlLinkList.length) links = firecrawlLinks(firecrawlLinkList, finalUrl);
  if (!links.length && markdown) links = linksFromMarkdown(markdown, finalUrl);

  const crawlRemote = envHas(ctx.env, "CRAWL4AI_API_KEY") || envHas(ctx.env, "CRAWL4AI_BASE_URL");
  if (on(ctx, "crawl4ai")) {
    if (fromFirecrawl && markdown) {
      runs.push(mkRun("crawl4ai", "skipped", 0, "Markdown dostarczył Firecrawl — Crawl4AI nie był wołany"));
    } else if (crawlRemote && ctx.remote.crawl4ai > 0 && timeLeft(ctx) > 3_000) {
      ctx.remote.crawl4ai -= 1;
      const t0 = Date.now();
      const page = await callCrawl4ai(url, {
        env: ctx.env,
        fetchImpl: ctx.fetchImpl,
        timeoutMs: Math.min(LIMITS.crawl4aiTimeoutMs, timeLeft(ctx) - 500),
      });
      if ("error" in page) {
        if (!markdown && html) markdown = htmlToMarkdown(html, finalUrl);
        runs.push(mkRun("crawl4ai", "error", Date.now() - t0, `${page.error} · zostawiono lokalny markdown`));
      } else {
        markdown = page.markdown;
        runs.push(
          mkRun(
            "crawl4ai",
            "live",
            Date.now() - t0,
            `Prawdziwy Crawl4AI · ${page.markdown.length.toLocaleString("pl-PL")} znaków`,
            page.markdown.length,
          ),
        );
      }
    } else if (!html && !markdown) {
      runs.push(mkRun("crawl4ai", "skipped", 0, "Brak HTML do konwersji"));
    } else {
      if (!markdown && html) markdown = htmlToMarkdown(html, finalUrl);
      runs.push(
        mkRun(
          "crawl4ai",
          "degraded",
          1,
          `Lokalny HTML→Markdown (${markdown.length.toLocaleString("pl-PL")} znaków). ${adapterPosture("crawl4ai", ctx.env).message}`,
          markdown.length,
        ),
      );
    }
  } else if (!markdown && html) {
    markdown = htmlToMarkdown(html, finalUrl);
  }

  if (on(ctx, "markitdown")) {
    const binary = /pdf|officedocument|msword|opendocument/i.test(contentType);
    if (binary && !markdown) {
      runs.push(
        mkRun(
          "markitdown",
          "skipped",
          0,
          `Typ ${contentType || "binarny"} — MarkItDown (Python) nie skonwertuje PDF/Office na serverless`,
        ),
      );
    } else if (markdown) {
      markdown = normalizeMarkdown(markdown);
      const words = markdown.split(/\s+/).filter(Boolean).length;
      runs.push(
        mkRun(
          "markitdown",
          "degraded",
          1,
          `Znormalizowano Markdown (${words} słów). To nie jest Microsoft MarkItDown.`,
          words,
        ),
      );
    } else {
      runs.push(mkRun("markitdown", "skipped", 0, "Brak tekstu do normalizacji"));
    }
  }

  if (on(ctx, "autoscraper")) {
    const patterns = extracted?.patterns ?? [];
    const total = patterns.reduce((sum, group) => sum + group.items.length, 0);
    runs.push(
      mkRun(
        "autoscraper",
        "degraded",
        1,
        patterns.length
          ? `Heurystyka CSS: ${patterns.length} wzorców (${total} elementów). To nie jest AutoScraper.`
          : "Heurystyka CSS nie znalazła powtarzalnych list. AutoScraper (Python) nie jest uruchomiony.",
        total,
      ),
    );
  }

  if (!markdown) markdown = [`# ${title}`, description].filter(Boolean).join("\n\n");
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  const structured = [
    ...firecrawlFields,
    ...(extracted?.structured ?? []).filter((field) => !firecrawlFields.some((f) => f.key === field.key)),
  ];

  return {
    url: finalUrl,
    title,
    description,
    markdown,
    textPreview: extracted?.textPreview || markdown.replace(/[#>*`[\]]/g, "").slice(0, 600),
    links,
    media: extracted?.media ?? [],
    structured,
    patterns: extracted?.patterns ?? [],
    interactive: extracted?.interactive ?? [],
    mobile: extracted?.mobile ?? emptyMobile(),
    wordCount,
    statusCode,
    contentType,
    engines: runs,
    fetchedAt: started,
  };
}

function buildSummary(
  query: string,
  mode: SpectraResult["resolvedMode"],
  hits: SearchHit[],
  sources: SourceResult[],
  discovery: DiscoveryRun[],
): string {
  const liveSources = discovery.filter((run) => run.status === "live" && run.hits > 0);
  if (sources.length === 0 && hits.length === 0) {
    return `Brak wyników dla „${query}”. Spróbuj innego zapytania albo wklej bezpośredni URL.`;
  }
  const lines: string[] = [];
  if (mode === "url" || (mode === "deep" && hits.some((hit) => hit.source === "direct") && liveSources.length === 0)) {
    const source = sources[0];
    if (source) {
      lines.push(`**${source.title}**`);
      if (source.description) lines.push(source.description);
      lines.push(
        `Źródło: ${source.url} · ${source.wordCount} słów · ${source.links.length} linków · HTTP ${source.statusCode || "—"}`,
      );
    }
    if (mode === "deep" && sources.length > 1) {
      lines.push(`Deep: pobrano ${sources.length} stron (w tym linki wewnętrzne).`);
    }
  } else {
    lines.push(
      `Znaleziono **${hits.length}** trafień dla „${query}” z ${liveSources.length} źródeł: ${liveSources.map((run) => run.label).join(", ") || "—"}.`,
    );
    if (sources.length) {
      lines.push(`Pobrano równolegle **${sources.length}** stron (deduplikacja URL, limit hostów).`);
      for (const source of sources.slice(0, 3)) {
        lines.push(`• **${source.title}** — ${(source.description || source.textPreview).slice(0, 140)}`);
      }
    }
  }
  return lines.join("\n\n");
}

export async function runSpectra(req: SpectraRequest): Promise<SpectraResult> {
  const query = req.query.trim();
  if (!query) throw new Error("Podaj zapytanie lub URL");

  const mode: SearchMode = req.mode ?? "auto";
  const resolved = resolveMode(query, mode);
  const enabled = new Set<EngineId>(req.engines?.length ? req.engines : ENGINES.map((engine) => engine.id));
  const pageBudget = clampPages(
    req.maxPages,
    resolved === "deep" ? LIMITS.defaultMaxPagesDeep : LIMITS.defaultMaxPagesSearch,
  );
  const targetPages = resolved === "url" ? 1 : pageBudget;
  const useAi = req.useAi !== false;
  const env = process.env;
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const deadline = t0 + LIMITS.searchBudgetMs;
  const ctx: ScrapeCtx = {
    enabled,
    env,
    fetchImpl: fetch,
    deadline,
    sessionId: crypto.randomUUID(),
    remote: {
      firecrawl: LIMITS.firecrawlCap,
      browser: LIMITS.browserUseCap,
      crawl4ai: LIMITS.crawl4aiCap,
    },
  };

  let hits: SearchHit[] = [];
  let discovery: DiscoveryRun[] = [];
  const queryIsUrl = resolved === "url" || (resolved === "deep" && isUrl(query));

  const queue: string[] = [];
  const scheduled = new Set<string>();
  const enqueue = (urls: string[]) => {
    for (const item of urls) {
      const key = canonicalUrl(item);
      if (!key || scheduled.has(key) || SKIP_EXT.test(key) || !isPublicHttpUrl(key)) continue;
      scheduled.add(key);
      queue.push(key);
    }
  };

  if (queryIsUrl && (resolved === "url" || resolved === "deep")) {
    const url = normalizeUrl(query);
    hits = [{ title: url, url, snippet: "Bezpośredni crawl URL", source: "direct" }];
    enqueue([url]);
  } else {
    const found = await runDiscovery(query, { env });
    hits = found.hits;
    discovery = found.runs;
    const seed =
      resolved === "deep" ? Math.min(LIMITS.deepSeedPages, targetPages) : targetPages;
    enqueue(selectDiverse(hits, seed, 2).map((hit) => hit.url));
  }

  const sources: SourceResult[] = [];
  const pageRuns: EngineRun[] = [];

  while (queue.length && sources.length < targetPages && Date.now() < deadline - 2_000) {
    const batch: string[] = [];
    while (
      queue.length &&
      batch.length < LIMITS.scrapeConcurrency &&
      sources.length + batch.length < targetPages
    ) {
      batch.push(queue.shift()!);
    }
    if (!batch.length) break;
    const scraped = await Promise.all(batch.map((item) => scrapeOne(item, ctx)));
    for (const source of scraped) {
      sources.push(source);
      pageRuns.push(...source.engines);
      if (resolved === "deep" && sources.length < targetPages) {
        const follow = selectDiverse(
          source.links.filter((link) => !link.external).map((link) => ({ url: link.href })),
          4,
          2,
        ).map((link) => link.url);
        enqueue(follow);
      }
    }
    if (resolved !== "deep") break;
  }

  if (resolved === "deep") {
    for (const source of sources) {
      if (hits.some((hit) => hit.url === source.url)) continue;
      hits.push({
        title: source.title,
        url: source.url,
        snippet: source.description || "Link wewnętrzny",
        source: "direct",
      });
    }
  }

  const globalRuns: EngineRun[] = [...pageRuns];
  if (enabled.has("crawlee")) {
    globalRuns.push(
      mkRun(
        "crawlee",
        "skipped",
        Date.now() - t0,
        `Niedostępny na serverless (brak workera Crawlee). Wbudowana kolejka SPECTRA: ${sources.length} stron, współbieżność ${LIMITS.scrapeConcurrency}, deduplikacja URL.`,
        sources.length,
      ),
    );
  }
  if (enabled.has("scrapy")) {
    globalRuns.push(mkRun("scrapy", "skipped", 0, adapterPosture("scrapy", env).message));
  }
  if (enabled.has("scrcpy")) {
    globalRuns.push(mkRun("scrcpy", "skipped", 0, adapterPosture("scrcpy", env).message));
  }

  const summarized = new Map(ENGINES.map((engine) => [engine.id, summarizeRuns(engine.id, globalRuns.filter((run) => run.id === engine.id))]));
  const engines: EngineRun[] = ENGINES.map((engine) => {
    if (!enabled.has(engine.id)) return mkRun(engine.id, "skipped", 0, "Wyłączony w tym skanie");
    const run = summarized.get(engine.id);
    if (run && globalRuns.some((item) => item.id === engine.id)) return run;
    const posture = adapterPosture(engine.id, env);
    const message =
      posture.status === "live"
        ? "Klucz jest ustawiony, ale w tym skanie adapter nie został wywołany"
        : posture.message;
    return mkRun(engine.id, "skipped", 0, message);
  });

  const effectiveness = scoreEffectiveness({ hits, sources, resolvedMode: resolved });
  const xai = getXaiStatus();
  let ai: SpectraResult["ai"] = {
    enabled: xai.available,
    used: false,
    model: xai.model,
    answer: "",
    keyPoints: [],
    confidence: 0,
    citations: [],
    error: xai.available ? (useAi ? undefined : "Synteza Grok wyłączona w tym skanie") : xai.note,
  };
  if (useAi && xai.available) {
    ai = await synthesizeWithGrok({
      query,
      mode: resolved,
      hits,
      sources,
      timeoutMs: synthesisAbortMs(Date.now() - t0),
    });
  }

  return {
    query,
    mode,
    resolvedMode: resolved,
    hits,
    sources,
    engines,
    discovery,
    summary: buildSummary(query, resolved, hits, sources, discovery),
    totalDurationMs: Date.now() - t0,
    startedAt,
    finishedAt: new Date().toISOString(),
    ai,
    effectiveness,
  };
}
