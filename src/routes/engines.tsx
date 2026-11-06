import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { CAPEX_SOURCES, OUTSIDE_SEARCH, QUERY_SOURCES } from "@/lib/catalog";
import { CASCADE_STEPS } from "@/lib/scrape/cascade";
import { ENGINES, type EngineId } from "@/lib/engines";
import { spectraEngineCatalog } from "@/lib/search";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/engines")({
  loader: () => spectraEngineCatalog(),
  component: EnginesPage,
});

function EnginesPage() {
  const { postures } = Route.useLoaderData();
  const local = ENGINES.filter((engine) => engine.surface === "local");
  const optional = ENGINES.filter((engine) => engine.surface === "optional");

  return (
    <AppShell>
      <div className="mb-8 max-w-2xl">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-signal">
          Katalog źródeł
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Źródła danych, nie dziesięć integracji
        </h1>
        <p className="mt-3 text-base text-fg-muted">
          Zapytanie tekstowe obsługują źródła poniżej. Po znalezieniu adresu SPECTRA sam pobiera
          stronę. Nazwy z GitHuba opisują albo krok lokalny, albo usługę z kluczem, albo coś, czego
          w tym wdrożeniu nie ma.
        </p>
        <Button asChild className="mt-5" variant="secondary">
          <Link to="/">Uruchom wyszukiwanie</Link>
        </Button>
      </div>

      <ol className="mb-8 grid gap-3 sm:grid-cols-2">
        {CASCADE_STEPS.map((step, index) => (
          <li key={step.id} className="rounded-[var(--radius-xl)] border border-border bg-surface/70 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-signal">
              Etap {index + 1}
            </p>
            <h2 className="mt-1 text-sm font-semibold text-fg">{step.label}</h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{step.role}</p>
          </li>
        ))}
      </ol>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-fg">Źródła zapytania</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {QUERY_SOURCES.map((source) => (
            <li
              key={source.id}
              className="rounded-[var(--radius-xl)] border border-border bg-surface/70 p-4"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-fg">{source.label}</h3>
                <Badge variant={source.tier === "free" ? "success" : "default"}>
                  {source.tier === "free" ? "bez klucza" : "opcjonalne"}
                </Badge>
              </div>
              <p className="text-sm leading-relaxed text-fg-muted">{source.detail}</p>
              {source.envKey && (
                <p className="mt-2 font-mono text-[11px] text-fg-subtle">{source.envKey}</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-fg">Firma / CapEx</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {CAPEX_SOURCES.map((source) => (
            <li
              key={source.id}
              className="rounded-[var(--radius-xl)] border border-border bg-surface/70 p-4"
            >
              <h3 className="text-sm font-semibold text-fg">{source.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{source.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold text-fg">Kroki lokalne po znalezieniu URL</h2>
        <p className="mb-3 text-xs text-fg-subtle">
          Wykonuje je SPECTRA. Historyczna nazwa zostaje tylko po to, żeby nie udawać tamtej
          biblioteki.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {local.map((engine) => {
            const posture = postures[engine.id as EngineId];
            const keyed = posture?.status === "live";
            return (
              <li
                key={engine.id}
                className="rounded-[var(--radius-xl)] border border-border bg-surface/70 p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">{engine.searchLabel}</h3>
                    <p className="font-mono text-[11px] text-fg-subtle">nie jest {engine.name}</p>
                  </div>
                  <Badge variant={keyed ? "success" : "default"}>
                    {keyed ? "API ustawione" : "krok lokalny"}
                  </Badge>
                </div>
                <p className="text-sm leading-relaxed text-fg-muted">{engine.description}</p>
                <a
                  href={engine.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-signal hover:underline"
                >
                  Historia nazwy <ArrowUpRight className="h-3 w-3" />
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold text-fg">Opcjonalne usługi crawl</h2>
        <p className="mb-3 text-xs text-fg-subtle">
          Wołane tylko z kluczem. Bez klucza skan ich nie udaje.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {optional.map((engine) => {
            const posture = postures[engine.id as EngineId];
            const keyed = posture?.status === "live";
            return (
              <li
                key={engine.id}
                className="rounded-[var(--radius-xl)] border border-border bg-surface/70 p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-fg">{engine.searchLabel}</h3>
                  <Badge variant={keyed ? "success" : "default"}>
                    {keyed ? "klucz ustawiony" : "brak klucza"}
                  </Badge>
                </div>
                <p className="text-sm leading-relaxed text-fg-muted">
                  {posture?.message || engine.runtimeNote}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-fg">Poza wyszukiwaniem</h2>
        <ul className="space-y-2">
          {OUTSIDE_SEARCH.map((item) => (
            <li
              key={item.id}
              className="rounded-[var(--radius-lg)] border border-border/80 bg-bg-elevated px-4 py-3"
            >
              <p className="text-sm font-medium text-fg">{item.label}</p>
              <p className="mt-1 text-sm text-fg-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
