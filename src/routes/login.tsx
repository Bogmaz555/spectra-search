import { createFileRoute, Link } from "@tanstack/react-router";
import { Radar } from "lucide-react";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="spectra-grid grid min-h-dvh place-items-center px-4 pt-[var(--grok-banner-h,0px)]">
      <div className="w-full max-w-sm rounded-[var(--radius-xl)] border border-border bg-surface p-6 shadow-soft">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid h-10 w-10 place-items-center rounded-[var(--radius-md)] border border-border bg-bg text-signal">
            <Radar className="h-5 w-5" />
          </span>
          <h1 className="font-display text-xl font-semibold tracking-tight text-fg">
            Zaloguj do SPECTRA
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Zapisz historię skanów i synchronizuj ustawienia silników.
          </p>
        </div>

        {authEnabled ? (
          <div className="space-y-2">
            {GROK_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => signIn(p.providerId, { callbackURL: "/" })}
              >
                Kontynuuj z {p.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-center text-sm text-fg-subtle">Logowanie jest wyłączone.</p>
        )}

        <p className="mt-6 text-center text-xs text-fg-subtle">
          <Link to="/" className="text-signal hover:underline">
            Wróć do wyszukiwania
          </Link>
        </p>
      </div>
    </main>
  );
}
