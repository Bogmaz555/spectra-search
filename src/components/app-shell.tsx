import { Link, useRouterState } from "@tanstack/react-router";
import { Layers, Radar, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserButton, SignedIn, SignedOut } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/", label: "Szukaj", icon: Search },
  { to: "/engines", label: "Silniki", icon: Layers },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, isPending } = useCurrentUserState();

  return (
    <div className="spectra-grid min-h-dvh">
      <div className="spectra-noise pointer-events-none fixed inset-0 opacity-60" aria-hidden />
      <header className="sticky top-0 z-40 border-b border-border/80 bg-bg/80 backdrop-blur-md pt-[var(--grok-banner-h,0px)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-border bg-surface text-signal">
              <Radar className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="flex flex-col leading-none">
              <span className="font-display text-sm font-semibold tracking-tight text-fg">
                SPECTRA
              </span>
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
                Multi-engine search
              </span>
            </span>
          </Link>

          <nav className="flex items-center gap-1 rounded-[var(--radius-lg)] border border-border bg-surface/80 p-1">
            {NAV.map(({ to, label, icon: Icon }) => {
              const active = pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-sm font-medium transition-colors duration-150",
                    active
                      ? "bg-surface-2 text-fg shadow-sm"
                      : "text-fg-muted hover:text-fg",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex min-w-[5.5rem] items-center justify-end">
            {isPending ? (
              <div className="h-8 w-8 animate-pulse rounded-full bg-surface-2" />
            ) : user ? (
              <SignedIn>
                <UserButton />
              </SignedIn>
            ) : (
              <SignedOut>
                <Button asChild variant="secondary" size="sm">
                  <Link to="/login">Zaloguj</Link>
                </Button>
              </SignedOut>
            )}
          </div>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-fg-subtle">
        <p>
          SPECTRA szuka w wielu źródłach i scrapuje strony równolegle. Status adaptera mówi, co naprawdę zadziałało.
        </p>
        <p className="mt-1 opacity-70">
          Darmowe źródła działają bez klucza. Firecrawl, Brave, Serper, Browser Use i Crawl4AI są opcjonalne.
        </p>
      </footer>
    </div>
  );
}
