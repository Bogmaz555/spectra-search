import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, GitBranch, Star } from "lucide-react";
import { ENGINES, type EngineId } from "@/lib/engines";
import { spectraEngineCatalog } from "@/lib/search";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/engines")({
  loader: () => spectraEngineCatalog(),
  component: EnginesPage,
});

const ROLE_LABEL: Record<string, string> = {
  fetch: "Pobieranie",
  render: "Render / agent",
  extract: "Ekstrakcja",
  markdown: "Markdown",
  structure: "Struktura",
  adapt: "Adaptacja",
  queue: "Kolejka",
  mobile: "Mobile",
  pattern: "Wzorce",
  scale: "Skala",
};

function postureBadge(status: string, envKeys?: string[]) {
  if (status === "live") return { variant: "success" as const, label: "klucz OK" };
  if (status === "degraded") return { variant: "warn" as const, label: "aproksymacja" };
  if (envKeys?.length) return { variant: "default" as const, label: "brak klucza" };
  return { variant: "default" as const, label: "niedostępny" };
}

function EnginesPage() {
  const { postures } = Route.useLoaderData();

  return (
    <AppShell>
      <div className="mb-8 max-w-2xl">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-signal">
          Katalog adapterów
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Dziesięć nazw. Uczciwy status.
        </h1>
        <p className="mt-3 text-base text-fg-muted">
          Każda nazwa z oryginalnego zestawu ma adapter ze zdolnością i jawnym trybem:
          prawdziwe API, lokalna aproksymacja albo brak w tym wdrożeniu. Scrapy, Crawlee
          i scrcpy nie udają, że właśnie przeleciały.
        </p>
        <Button asChild className="mt-5" variant="secondary">
          <Link to="/">Uruchom wyszukiwanie</Link>
        </Button>
      </div>

      <ol className="grid gap-4 sm:grid-cols-2">
        {ENGINES.map((eng) => {
          const posture = postures[eng.id as EngineId];
          const badge = postureBadge(posture?.status ?? "skipped", eng.envKeys);
          return (
            <li
              key={eng.id}
              className="group flex flex-col rounded-[var(--radius-xl)] border border-border bg-surface/70 p-5 transition-colors hover:border-border-strong"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] border border-border bg-bg font-mono text-xs font-semibold text-fg-muted">
                    {String(eng.order).padStart(2, "0")}
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-fg">{eng.name}</h2>
                    <p className="font-mono text-[11px] text-fg-subtle">{eng.repo}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <Badge variant="default">{ROLE_LABEL[eng.role] ?? eng.role}</Badge>
                </div>
              </div>

              <p className="text-sm font-medium text-fg">{eng.tagline}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-muted">{eng.description}</p>
              <p className="mt-3 text-xs leading-relaxed text-fg-subtle">{posture?.message || eng.runtimeNote}</p>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs text-fg-subtle">
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3 w-3" /> {eng.stars}
                </span>
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="h-3 w-3" /> {eng.license}
                </span>
                <span className="ml-auto text-fg-muted">{eng.capabilities.join(" · ")}</span>
              </div>

              <a
                href={eng.github}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-signal hover:underline"
              >
                GitHub <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </li>
          );
        })}
      </ol>
    </AppShell>
  );
}
