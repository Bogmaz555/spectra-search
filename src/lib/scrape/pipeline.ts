import { DEFAULT_ENGINE_IDS, ENGINES, type EngineId } from "../engines.ts";
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
  SerpapiBudget,
  fetchSerpapiQuota,
  getSerpapiStatus,
  hasSerpapiKey,
  SERPAPI_ENV_KEY,
} from "./serpapi.ts";
import {
  applyRegistryToCard,
  capexCrawlPlan,
  COMPANY_SITE_PATHS,
  companyOrigins,
  emptyCapexCard,
  isGoogleNewsHost,
  parseCapexInput,
  probeCompanyPaths,
  searchCapexNews,
  type CapexInput,
} from "./capex.ts";
import {
  extractRegistryIds,
  krsDiscoveryStatus,
  krsSourceResult,
  resolveCapexRegistry,
  type KrsRegistry,
} from "./krs.ts";
import { emptySourceMessage, hitOutcome } from "./outcome.ts";
import { buildResearchStages, countWords, queryCoverage } from "./cascade.ts";
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

const SKIP_EXT =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|mp4|mp3|zip|gz|rar)(\?|$)/i;

function hostnamePath(raw: string): string {
  try {
    return new URL(raw).pathname || raw;
  } catch {
    return raw;
  }
}

type Env = Record<string, string | undefined>;

interface ScrapeStats {
  cheapOk: number;
  cheapFail: number;
  cheapSkipped: number;
  thinPages: number;
  firecrawlCalls: number;
  firecrawlOk: number;
  browserCalls: number;
  browserOk: number;
  crawl4aiCalls: number;
  crawl4aiOk: number;
  followed: number;
}

interface ScrapeCtx {
  enabled: Set<EngineId>;
  env: Env;
  fetchImpl: typeof fetch;
  deadline: number;
  sessionId: string;
  remote: { firecrawl: number; browser: number; crawl4ai: number };
  stats: ScrapeStats;
}

function emptyMobile(): MobileInsight {
  return { hasAppLinks: false, isMobileOptimized: false };
}

function blankSource(
  url: string,
  engines: EngineRun[],
  title: string,
  description: string,
): SourceResult {
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
    ctx.stats.cheapFail += 1;
    runs.push(
      mkRun("curl-impersonate", "error", 0, "Budżet czasu funkcji wyczerpany — strona pominięta"),
    );
    return { ...blankSource(url, runs, "Pominięto", "Budżet czasu"), fetchedAt: started };
  }
  if (!(await isPublicHttpUrlResolved(url))) {
    ctx.stats.cheapFail += 1;
    runs.push(
      mkRun(
        "curl-impersonate",
        "error",
        0,
        "URL odrzucony (adres prywatny, lokalny albo nie-HTTP)",
      ),
    );
    return {
      ...blankSource(url, runs, "Odrzucony URL", "Adres nie jest publicznym HTTP(S)"),
      fetchedAt: started,
    };
  }
  if (!(await allowedByRobots(url, ctx.fetchImpl))) {
    ctx.stats.cheapSkipped += 1;
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
      ...blankSource(
        url,
        runs,
        "Zablokowane przez robots.txt",
        "Ścieżka jest wyłączona w robots.txt",
      ),
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

  const fetched: HttpResult = await resilientGet(url, {
    fetchImpl: ctx.fetchImpl,
    timeoutMs: Math.min(LIMITS.fetchTimeoutMs, Math.max(2_000, timeLeft(ctx) - 500)),
    respectRobots: true,
  });
  finalUrl = canonicalUrl(fetched.url) ?? fetched.url;
  statusCode = fetched.statusCode;
  contentType = fetched.contentType;
  html = fetched.body;
  const cheapThin =
    !fetched.robotsBlocked &&
    (fetched.blocked || !fetched.ok || visibleTextLength(html) < 80);
  if (fetched.robotsBlocked) ctx.stats.cheapSkipped += 1;
  else if (!fetched.ok || fetched.blocked) {
    ctx.stats.cheapFail += 1;
    ctx.stats.thinPages += 1;
  } else if (cheapThin) {
    ctx.stats.cheapOk += 1;
    ctx.stats.thinPages += 1;
  } else ctx.stats.cheapOk += 1;

  if (on(ctx, "curl-impersonate")) {
    if (fetched.robotsBlocked) {
      runs.push(
        mkRun("curl-impersonate", "skipped", fetched.durationMs, fetched.error || "robots.txt"),
      );
    } else if (fetched.ok) {
      runs.push(
        mkRun(
          "curl-impersonate",
          "local",
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
    if (fetched.robotsBlocked) {
      runs.push(mkRun("scrapling", "skipped", 0, "robots.txt — bez obchodzenia zakazu"));
    } else if (fetched.blocked || fetched.attempts > 1) {
      runs.push(
        mkRun(
          "scrapling",
          "local",
          fetched.durationMs,
          fetched.blocked
            ? `Wykryto blokadę po ${fetched.attempts} próbach. To lokalna heurystyka, nie biblioteka Scrapling.`
            : `Powtórzono pobranie (${fetched.attempts} próby) bez śladu blokady. To nie jest Scrapling.`,
          fetched.attempts,
        ),
      );
    } else {
      runs.push(
        mkRun(
          "scrapling",
          "not_applicable",
          fetched.durationMs,
          "Nie dotyczy — jedna odpowiedź, bez śladu blokady. Biblioteka Scrapling nie jest uruchomiona.",
        ),
      );
    }
  }

  const rich = () => countWords(markdown) >= 40 || visibleTextLength(html) >= 280;
  const firecrawlKey = ctx.env.FIRECRAWL_API_KEY?.trim();
  if (on(ctx, "firecrawl")) {
    if (fetched.robotsBlocked) {
      runs.push(mkRun("firecrawl", "skipped", 0, "robots.txt — Firecrawl nie omija zakazu"));
    } else if (!cheapThin) {
      runs.push(
        mkRun("firecrawl", "skipped", 0, "Tanie pobranie wystarczyło — Firecrawl nie był wołany."),
      );
    } else if (!firecrawlKey) {
      runs.push(
        mkRun(
          "firecrawl",
          "skipped",
          0,
          "Strona cienka albo zablokowana, ale brak FIRECRAWL_API_KEY — płatny fallback pominięty.",
        ),
      );
    } else if (!isPublicHttpUrl(url) || ctx.remote.firecrawl <= 0 || timeLeft(ctx) < 3_000) {
      runs.push(
        mkRun("firecrawl", "skipped", 0, "Za mało czasu albo limit Firecrawl na to zapytanie."),
      );
    } else {
      ctx.remote.firecrawl -= 1;
      ctx.stats.firecrawlCalls += 1;
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
        ctx.stats.firecrawlOk += 1;
        if (page.html) html = page.html;
        if (page.markdown) markdown = page.markdown;
        title = page.title || title;
        description = page.description || description;
        finalUrl = canonicalUrl(page.sourceUrl) ?? finalUrl;
        statusCode = page.statusCode || statusCode || 200;
        if (page.html) contentType = "text/html";
        else if (page.markdown) contentType = "text/markdown";
        firecrawlFields = page.fields;
        firecrawlLinkList = page.links;
        runs.push(
          mkRun(
            "firecrawl",
            "live",
            Date.now() - t0,
            `Fallback Firecrawl /v1/scrape · ${page.fields.length} pól · ${page.links.length} linków`,
            page.fields.length,
          ),
        );
      }
    }
  }

  const stillThin = cheapThin && !fetched.robotsBlocked && !rich();
  const browserKey = ctx.env.BROWSER_USE_API_KEY?.trim();
  if (on(ctx, "browser-use")) {
    if (fetched.robotsBlocked) {
      runs.push(
        mkRun("browser-use", "skipped", 0, "robots.txt zabrania ścieżki — Browser Use jej nie omija"),
      );
    } else if (!cheapThin || !stillThin) {
      runs.push(
        mkRun(
          "browser-use",
          "skipped",
          0,
          fromFirecrawl
            ? "Firecrawl uzupełnił treść — Browser Use nie był wołany."
            : "Tanie pobranie wystarczyło — Browser Use nie był wołany.",
        ),
      );
    } else if (!browserKey) {
      runs.push(
        mkRun(
          "browser-use",
          "skipped",
          0,
          "Strona nadal cienka, ale brak BROWSER_USE_API_KEY — fallback pominięty.",
        ),
      );
    } else if (ctx.remote.browser <= 0 || timeLeft(ctx) < 3_000) {
      runs.push(mkRun("browser-use", "skipped", 0, "Za mało czasu albo limit Browser Use na to zapytanie."));
    } else {
      ctx.remote.browser -= 1;
      ctx.stats.browserCalls += 1;
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
        ctx.stats.browserOk += 1;
        html = page.body;
        markdown = "";
        finalUrl = canonicalUrl(page.finalUrl) ?? page.finalUrl;
        statusCode = page.statusCode || statusCode;
        contentType = page.contentType || "text/html";
        runs.push(
          mkRun(
            "browser-use",
            "live",
            Date.now() - t0,
            `Fallback fetch.browser-use.com · HTTP ${page.statusCode || "—"} · uproszczony HTML`,
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
  if (!links.length && firecrawlLinkList.length)
    links = firecrawlLinks(firecrawlLinkList, finalUrl);
  if (!links.length && markdown) links = linksFromMarkdown(markdown, finalUrl);

  if (!markdown && html) markdown = htmlToMarkdown(html, finalUrl);
  const crawlRemote = envHas(ctx.env, "CRAWL4AI_API_KEY") || envHas(ctx.env, "CRAWL4AI_BASE_URL");
  const needRemoteMarkdown =
    !fetched.robotsBlocked && cheapThin && countWords(markdown) < 40 && !fromFirecrawl;
  if (on(ctx, "crawl4ai")) {
    if (!html && !markdown) {
      runs.push(mkRun("crawl4ai", "skipped", 0, "Brak HTML do konwersji"));
    } else if (!needRemoteMarkdown) {
      runs.push(
        mkRun(
          "crawl4ai",
          "local",
          1,
          `Lokalny HTML→Markdown (${countWords(markdown)} słów) wystarcza. Crawl4AI nie był wołany.`,
          markdown.length,
        ),
      );
    } else if (crawlRemote && ctx.remote.crawl4ai > 0 && timeLeft(ctx) > 3_000) {
      ctx.remote.crawl4ai -= 1;
      ctx.stats.crawl4aiCalls += 1;
      const t0 = Date.now();
      const page = await callCrawl4ai(url, {
        env: ctx.env,
        fetchImpl: ctx.fetchImpl,
        timeoutMs: Math.min(LIMITS.crawl4aiTimeoutMs, timeLeft(ctx) - 500),
      });
      if ("error" in page) {
        runs.push(
          mkRun(
            "crawl4ai",
            "error",
            Date.now() - t0,
            `${page.error} · zostawiono lokalny markdown`,
          ),
        );
      } else {
        ctx.stats.crawl4aiOk += 1;
        markdown = page.markdown;
        runs.push(
          mkRun(
            "crawl4ai",
            "live",
            Date.now() - t0,
            `Fallback Crawl4AI · ${page.markdown.length.toLocaleString("pl-PL")} znaków`,
            page.markdown.length,
          ),
        );
      }
    } else {
      runs.push(
        mkRun(
          "crawl4ai",
          "local",
          1,
          `Krótki lokalny markdown (${countWords(markdown)} słów). ${crawlRemote ? "Brak budżetu na Crawl4AI." : "To nie jest Crawl4AI — brak klucza i adresu instancji."}`,
          markdown.length,
        ),
      );
    }
  }

  if (on(ctx, "markitdown")) {
    const binary = /pdf|officedocument|msword|opendocument/i.test(contentType);
    if (binary && !markdown) {
      runs.push(
        mkRun(
          "markitdown",
          "not_applicable",
          0,
          `Nie dotyczy — typ ${contentType || "binarny"}. PDF i Office nie są konwertowane (to nie jest Microsoft MarkItDown).`,
        ),
      );
    } else if (markdown) {
      markdown = normalizeMarkdown(markdown);
      const words = markdown.split(/\s+/).filter(Boolean).length;
      runs.push(
        mkRun(
          "markitdown",
          "local",
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
        patterns.length ? "local" : "not_applicable",
        1,
        patterns.length
          ? `Heurystyka CSS: ${patterns.length} wzorców (${total} elementów). To nie jest AutoScraper.`
          : "Nie dotyczy — brak powtarzalnej listy. AutoScraper (Python) nie jest uruchomiony.",
        total,
      ),
    );
  }

  if (!markdown) markdown = [`# ${title}`, description].filter(Boolean).join("\n\n");
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  const structured = [
    ...firecrawlFields,
    ...(extracted?.structured ?? []).filter(
      (field) => !firecrawlFields.some((f) => f.key === field.key),
    ),
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
  if (
    mode === "url" ||
    (mode === "deep" && hits.some((hit) => hit.source === "direct") && liveSources.length === 0)
  ) {
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
      lines.push(
        `Pobrano równolegle **${sources.length}** stron (deduplikacja URL, limit hostów).`,
      );
      for (const source of sources.slice(0, 3)) {
        lines.push(
          `• **${source.title}** — ${(source.description || source.textPreview).slice(0, 140)}`,
        );
      }
    }
  }
  return lines.join("\n\n");
}

export interface SpectraHooks {
  /** Test/runtime override. The public server function never forwards client input here. */
  env?: Env;
  fetchImpl?: typeof fetch;
}

export async function runSpectra(
  req: SpectraRequest,
  hooks: SpectraHooks = {},
): Promise<SpectraResult> {
  const query = req.query.trim();
  if (!query) throw new Error("Podaj zapytanie lub URL");

  const mode: SearchMode = req.mode ?? "auto";
  const resolved = resolveMode(query, mode);
  const requested = req.engines?.length ? req.engines : DEFAULT_ENGINE_IDS;
  const enabled = new Set<EngineId>(requested);
  const pageBudget = clampPages(
    req.maxPages,
    resolved === "deep" ? LIMITS.defaultMaxPagesDeep : LIMITS.defaultMaxPagesSearch,
  );
  const targetPages = resolved === "url" ? 1 : pageBudget;
  const useAi = req.useAi !== false;
  const env = hooks.env ?? process.env;
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const deadline = t0 + LIMITS.searchBudgetMs;
  const ctx: ScrapeCtx = {
    enabled,
    env,
    fetchImpl: hooks.fetchImpl ?? fetch,
    deadline,
    sessionId: crypto.randomUUID(),
    remote: {
      firecrawl: LIMITS.firecrawlCap,
      browser: LIMITS.browserUseCap,
      crawl4ai: LIMITS.crawl4aiCap,
    },
    stats: {
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
    },
  };

  const serpapiBudget = new SerpapiBudget(LIMITS.serpapiCap);
  const serpapiKey = env[SERPAPI_ENV_KEY]?.trim() ?? "";
  const serpapiQuotaTask =
    serpapiKey && hasSerpapiKey(env)
      ? fetchSerpapiQuota(serpapiKey, { fetchImpl: ctx.fetchImpl })
      : Promise.resolve(null);

  let hits: SearchHit[] = [];
  let discovery: DiscoveryRun[] = [];
  let capexInput: CapexInput | null = null;
  let capexRegistry: KrsRegistry | null = null;
  let capexRegistryTask: Promise<KrsRegistry> | null = null;
  let capexKrsStarted = 0;
  const queryIsUrl = resolved === "url" || (resolved === "deep" && isUrl(query));

  const queue: string[] = [];
  const scheduled = new Set<string>();
  const enqueue = (
    urls: string[],
    channel: "seed" | "follow" = "seed",
    opts?: { explainUnsafe?: boolean },
  ) => {
    let added = 0;
    for (const item of urls) {
      const key = canonicalUrl(item);
      if (!key || scheduled.has(key) || SKIP_EXT.test(key)) continue;
      if (!isPublicHttpUrl(key)) {
        // The address the user typed still reaches scrapeOne, which refuses it
        // before any socket. Discovered links stay dropped.
        if (!opts?.explainUnsafe) continue;
        try {
          const parsed = new URL(key);
          if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username) continue;
        } catch {
          continue;
        }
      }
      scheduled.add(key);
      queue.push(key);
      added += 1;
    }
    if (channel === "follow") ctx.stats.followed += added;
    return added;
  };

  if (resolved === "capex") {
    capexInput = parseCapexInput(query);
    const input = capexInput;
    capexKrsStarted = Date.now();
    if (input.krs || input.nip) {
      capexRegistryTask = resolveCapexRegistry({
        krs: input.krs,
        nip: input.nip,
        fetchImpl: ctx.fetchImpl,
      });
    }
    const userOrigin = companyOrigins(input.company, input.urls, [])[0];
    const timedProbe = async (origin: string | undefined) => {
      if (!origin || timeLeft(ctx) < 4_000) return { paths: [] as string[], ms: 0 };
      const started = Date.now();
      try {
        const paths = await probeCompanyPaths(origin, { fetchImpl: ctx.fetchImpl });
        return { paths, ms: Date.now() - started };
      } catch {
        return { paths: [] as string[], ms: Date.now() - started };
      }
    };
    const recordNews = (news: Awaited<ReturnType<typeof searchCapexNews>>, started: number) => {
      const publishers = news.investment.filter((hit) => !isGoogleNewsHost(hit.url)).length;
      const via = news.serpapiCalls ? ` · SerpAPI ${news.serpapiCalls} (reszta to RSS)` : "";
      discovery.push({
        id: "google-news",
        label: news.serpapiCalls
          ? "SerpAPI Google News + RSS (CapEx)"
          : "Google News RSS (szablony CapEx)",
        status: hitOutcome(news.investment.length, news.investmentFailed, news.investmentQueries),
        hits: news.investment.length,
        durationMs: Date.now() - started,
        message: emptySourceMessage({
          hits: news.investment.length,
          failed: news.investmentFailed,
          attempts: news.investmentQueries,
          filled: `${news.investment.length} newsów z ${news.investmentQueries} zapytań, ${publishers} linków wydawcy${via}`,
          allFailed: `Błąd: ${news.investmentFailed}/${news.investmentQueries} zapytań news bez odpowiedzi (RSS${news.serpapiCalls ? " po nieudanym SerpAPI" : ""}).`,
          partial: `Błąd części zapytań: ${news.investmentFailed}/${news.investmentQueries} nie doszło, reszta odpowiedziała pusto.${via}`,
          empty: `Brak newsów. ${news.investmentQueries} zapytań RSS odpowiedziało pusto — to nie jest awaria źródła.`,
        }),
      });
      discovery.push({
        id: "capex-press",
        label: "Prasa branżowa (site:)",
        status: hitOutcome(news.press.length, news.pressFailed, news.pressQueries),
        hits: news.press.length,
        durationMs: Date.now() - started,
        message: emptySourceMessage({
          hits: news.press.length,
          failed: news.pressFailed,
          attempts: news.pressQueries,
          filled: `${news.press.length} trafień z ${news.pressQueries} tytułów${via}`,
          allFailed: `Błąd prasy: ${news.pressFailed}/${news.pressQueries} szablonów site: bez odpowiedzi.`,
          partial: `Część tytułów padła (${news.pressFailed}/${news.pressQueries}), reszta bez trafień.`,
          empty: `Brak trafień. ${news.pressQueries} szablonów site: (WNP, Puls Biznesu, automatyka, opakowania, przemysł) odpowiedziało pusto.`,
        }),
      });
    };

    const direct: SearchHit[] = input.urls.map((url) => ({
      title: url,
      url,
      snippet: "URL podany przez użytkownika",
      source: "direct",
    }));
    let found: SearchHit[] = [];
    let paths: string[] = [];
    let probeMs = 0;
    let probedOrigin = userOrigin;

    if (input.company) {
      const t1 = Date.now();
      const [news, general, probed] = await Promise.all([
        searchCapexNews(input.company, { fetchImpl: ctx.fetchImpl, env, serpapiBudget }),
        runDiscovery(`${input.company} inwestycja`, { env, fetchImpl: ctx.fetchImpl, serpapiBudget }),
        timedProbe(userOrigin),
      ]);
      recordNews(news, t1);
      discovery.push(...general.runs);
      found = [...news.investment, ...news.press, ...general.hits];
      paths = probed.paths;
      probeMs = probed.ms;
    } else if (capexRegistryTask && timeLeft(ctx) > 8_000) {
      capexRegistry = await capexRegistryTask;
      const legalName = capexRegistry.name?.trim();
      if (legalName) {
        const t1 = Date.now();
        const news = await searchCapexNews(legalName, { fetchImpl: ctx.fetchImpl, env, serpapiBudget });
        recordNews(news, t1);
        found = [...news.investment, ...news.press];
      }
      const probed = await timedProbe(userOrigin);
      paths = probed.paths;
      probeMs = probed.ms;
    } else {
      const probed = await timedProbe(userOrigin);
      paths = probed.paths;
      probeMs = probed.ms;
    }

    if (!paths.length && !userOrigin && timeLeft(ctx) > 4_000) {
      const fromHits = companyOrigins(
        input.company || capexRegistry?.name || "",
        [],
        found.map((hit) => hit.url),
      )[0];
      if (fromHits) {
        probedOrigin = fromHits;
        const probed = await timedProbe(fromHits);
        paths = probed.paths;
        probeMs = probed.ms;
      }
    }

    discovery.push({
      id: "company-paths",
      label: "Ścieżki firmy",
      status: paths.length ? "live" : probedOrigin ? "skipped" : "not_applicable",
      hits: paths.length,
      durationMs: probeMs,
      message: paths.length
        ? paths.map((url) => hostnamePath(url)).join(", ")
        : probedOrigin
          ? `Żadna ze ścieżek ${COMPANY_SITE_PATHS.join(" ")} nie zwróciła HTTP 200 (${probedOrigin}).`
          : "Nie dotyczy — brak domeny firmy (nie podano URL i nie wynika z wyników).",
    });

    const pathHits: SearchHit[] = paths.map((url) => ({
      title: hostnamePath(url),
      url,
      snippet: "Ścieżka firmy · HTTP 200",
      source: "company-site",
    }));
    hits = [...direct, ...pathHits, ...found];
    const crawlable = found.filter((hit) => !isGoogleNewsHost(hit.url));
    const newsPick = selectDiverse(crawlable, targetPages, 2).map((hit) => hit.url);
    enqueue(
      capexCrawlPlan({
        direct: direct.map((hit) => hit.url),
        companyPaths: paths,
        news: newsPick,
        maxPages: targetPages,
      }),
    );
  } else if (queryIsUrl && (resolved === "url" || resolved === "deep")) {
    const url = normalizeUrl(query);
    hits = [{ title: url, url, snippet: "Bezpośredni crawl URL", source: "direct" }];
    enqueue([url], "seed", { explainUnsafe: true });
    discovery = [
      {
        id: "query-sources",
        label: "Źródła zapytań",
        status: "not_applicable",
        hits: 0,
        durationMs: 0,
        message:
          "Nie dotyczy — podano adres. SerpAPI, Wikipedia, DuckDuckGo, KRS i newsy nie były wołane. Poniżej jest pobranie tej strony.",
      },
    ];
  } else {
    const found = await runDiscovery(query, { env, fetchImpl: ctx.fetchImpl, serpapiBudget });
    hits = found.hits;
    discovery = found.runs;
    const seed = resolved === "deep" ? Math.min(LIMITS.deepSeedPages, targetPages) : targetPages;
    enqueue(selectDiverse(hits, seed, 2).map((hit) => hit.url));
  }

  if (hasSerpapiKey(env) || serpapiBudget.used > 0) {
    const left = await serpapiQuotaTask;
    if (typeof left === "number") serpapiBudget.remainingQuota = left;
    discovery.push({
      id: "serpapi-budget",
      label: "SerpAPI budżet",
      status: serpapiBudget.used > 0 ? "live" : "skipped",
      hits: serpapiBudget.used,
      durationMs: 0,
      message:
        serpapiBudget.used > 0
          ? `Zużyto ${serpapiBudget.used}/${serpapiBudget.maxCalls} wyszukiwań` +
            (typeof left === "number" ? ` · pozostało w planie ~${left}` : "")
          : getSerpapiStatus(env).note,
    });
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
        enqueue(follow, "follow");
      }
    }
    const thinCorpus =
      sources.reduce((sum, source) => sum + source.wordCount, 0) < LIMITS.rescueMinWords;
    if (
      resolved === "search" &&
      ctx.stats.followed === 0 &&
      thinCorpus &&
      timeLeft(ctx) > 8_000 &&
      sources.length < targetPages
    ) {
      let room = Math.min(LIMITS.rescuePages, targetPages - sources.length);
      for (const source of sources) {
        if (room <= 0) break;
        const internal = source.links
          .filter((link) => !link.external)
          .map((link) => ({ url: link.href }));
        const picked = selectDiverse(internal, room, 1).map((link) => link.url);
        room -= enqueue(picked, "follow");
      }
      if (queue.length) continue;
    }
    // CapEx drains company paths and publisher URLs. It does not follow internal links.
    if (resolved !== "deep" && resolved !== "capex") break;
  }

  if (resolved === "capex" && capexInput) {
    if (capexRegistryTask && !capexRegistry) {
      try {
        capexRegistry = await capexRegistryTask;
      } catch (err) {
        const message = err instanceof Error ? err.message : "błąd KRS";
        capexRegistry = { people: [], note: `KRS niedostępne (${message.slice(0, 140)})` };
      }
    }
    if (!capexRegistry?.people.length) {
      const blob = sources
        .map((source) => `${source.title}\n${source.markdown}`)
        .join("\n")
        .slice(0, 80_000);
      const ids = extractRegistryIds(blob);
      if (ids.krs && ids.krs !== capexRegistry?.krs) {
        try {
          capexRegistry = await resolveCapexRegistry({
            krs: ids.krs,
            nip: ids.nip ?? capexInput.nip,
            fetchImpl: ctx.fetchImpl,
          });
        } catch {
          /* keep the earlier note */
        }
      } else if (!capexRegistry && ids.nip) {
        try {
          capexRegistry = await resolveCapexRegistry({ nip: ids.nip, fetchImpl: ctx.fetchImpl });
        } catch {
          capexRegistry = null;
        }
      }
    }
    const registrySource = capexRegistry ? krsSourceResult(capexRegistry) : null;
    if (registrySource && !sources.some((source) => source.url === registrySource.url)) {
      sources.unshift(registrySource);
      hits.unshift({
        title: registrySource.title,
        url: registrySource.url,
        snippet: registrySource.description || "Odpis aktualny KRS",
        source: "krs",
      });
    }
    const krsRow = krsDiscoveryStatus(capexRegistry);
    discovery.push({
      id: "krs",
      label: "KRS (api-krs.ms.gov.pl)",
      status: krsRow.status,
      hits: capexRegistry?.people.length ?? 0,
      durationMs: capexKrsStarted ? Date.now() - capexKrsStarted : 0,
      message: krsRow.message,
    });
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

  const summarized = new Map(
    ENGINES.map((engine) => [
      engine.id,
      summarizeRuns(
        engine.id,
        globalRuns.filter((run) => run.id === engine.id),
      ),
    ]),
  );
  const engines: EngineRun[] = ENGINES.filter((engine) => engine.surface !== "unavailable").map(
    (engine) => {
      if (!enabled.has(engine.id)) return mkRun(engine.id, "skipped", 0, "Wyłączony w tym skanie");
      const run = summarized.get(engine.id);
      if (run && globalRuns.some((item) => item.id === engine.id)) return run;
      if (engine.surface === "optional") {
        const posture = adapterPosture(engine.id, env);
        return mkRun(
          engine.id,
          "skipped",
          0,
          posture.status === "live"
            ? "Klucz jest ustawiony, ale w tym skanie usługa nie była wołana."
            : "Pominięte — brak klucza. Darmowe źródła i lokalne pobranie działają bez tej usługi.",
        );
      }
      return mkRun(
        engine.id,
        "not_applicable",
        0,
        "Nie dotyczy — nie pobrano strony, więc ten krok lokalny się nie wykonał.",
      );
    },
  );

  const corpus = sources.map((source) => `${source.title}\n${source.markdown}`).join("\n");
  const coverage = queryCoverage(query, corpus);
  const effectiveness = scoreEffectiveness({
    hits,
    sources,
    resolvedMode: resolved,
    coverage: coverage.ratio,
  });
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
      capex: resolved === "capex" ? capexInput?.company || capexRegistry?.name || query : undefined,
      registryContext: capexRegistry?.markdown,
    });
  }
  if (
    resolved === "capex" &&
    capexInput &&
    (ai.capex || capexRegistry?.people.length || capexRegistry?.note || capexRegistry?.krs)
  ) {
    const company = capexInput.company || capexRegistry?.name || query;
    const base = ai.capex ?? emptyCapexCard(company, ai.citations);
    ai = { ...ai, capex: applyRegistryToCard(base, capexRegistry, company) };
  }

  const hosts = new Set(
    sources
      .map((source) => {
        try {
          return new URL(source.url).hostname;
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
  const stages = buildResearchStages({
    mode: resolved,
    query,
    discovery,
    hits: hits.length,
    pages: sources.length,
    cheapOk: ctx.stats.cheapOk,
    cheapFail: ctx.stats.cheapFail,
    cheapSkipped: ctx.stats.cheapSkipped,
    thinPages: ctx.stats.thinPages,
    firecrawlCalls: ctx.stats.firecrawlCalls,
    firecrawlOk: ctx.stats.firecrawlOk,
    browserCalls: ctx.stats.browserCalls,
    browserOk: ctx.stats.browserOk,
    crawl4aiCalls: ctx.stats.crawl4aiCalls,
    crawl4aiOk: ctx.stats.crawl4aiOk,
    followed: ctx.stats.followed,
    words: sources.reduce((sum, source) => sum + source.wordCount, 0),
    fields: sources.reduce((sum, source) => sum + source.structured.length, 0),
    patterns: sources.reduce((sum, source) => sum + source.patterns.length, 0),
    hosts: hosts.size,
    httpOk: sources.filter((source) => source.statusCode > 0 && source.statusCode < 400).length,
    coverage: coverage.ratio,
    covered: coverage.covered,
    missing: coverage.missing,
    useAi,
    ai,
  });

  return {
    query,
    mode,
    resolvedMode: resolved,
    hits,
    sources,
    engines,
    stages,
    discovery,
    summary: buildSummary(query, resolved, hits, sources, discovery),
    totalDurationMs: Date.now() - t0,
    startedAt,
    finishedAt: new Date().toISOString(),
    ai,
    effectiveness,
  };
}
