import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, GitBranch, Star } from "lucide-react";
import { ENGINES } from "@/lib/engines";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/engines")({ component: EnginesPage });

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

function EnginesPage() {
  return (
    <AppShell>
      <div className="mb-8 max-w-2xl">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-signal">
          Katalog silników
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Dziesięć repozytoriów. Jeden pipeline.
        </h1>
        <p className="mt-3 text-base text-fg-muted">
          SPECTRA orkiestruje najlepsze open-source narzędzia do crawlingu i ekstrakcji —
          od fingerprintu HTTP po Markdown gotowy dla AI. Każdy silnik ma jasną rolę w
          łańcuchu.
        </p>
        <Button asChild className="mt-5" variant="secondary">
          <Link to="/">Uruchom wyszukiwanie</Link>
        </Button>
      </div>

      <ol className="grid gap-4 sm:grid-cols-2">
        {ENGINES.map((eng) => (
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
              <Badge variant="default">{ROLE_LABEL[eng.role] ?? eng.role}</Badge>
            </div>

            <p className="text-sm font-medium text-fg">{eng.tagline}</p>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-muted">
              {eng.description}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs text-fg-subtle">
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3" /> {eng.stars}
              </span>
              <span className="inline-flex items-center gap-1">
                <GitBranch className="h-3 w-3" /> {eng.license}
              </span>
              <span className="ml-auto text-fg-muted">{eng.pipelineStep}</span>
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
        ))}
      </ol>
    </AppShell>
  );
}
