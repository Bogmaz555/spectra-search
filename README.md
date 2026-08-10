# SPECTRA — Multi-engine Search Portal

Kompleksowy portal wyszukiwania łączący 10 open-source silników crawlingu w jeden pipeline:

Firecrawl · Crawl4AI · Browser Use · Crawlee · Scrapy · MarkItDown · Scrapling · scrcpy · AutoScraper · curl-impersonate

Opcjonalnie **Grok (xAI)** syntezuje odpowiedź z wyciągniętych źródeł.

## Stack

- React 19 + TanStack Start / Router
- Vite 8 + Tailwind v4
- Cheerio (server scrape)
- Better Auth
- Vercel (Nitro preset)

## Lokalnie

```bash
npm install
npm run dev      # http://localhost:8080
npm run build
npm run typecheck
```

## Zmienne środowiskowe (Vercel)

| Zmienna | Wymagana | Opis |
|---------|----------|------|
| `XAI_API_KEY` | nie | Klucz xAI — włącza syntezę Grok |
| `DATABASE_URL` | nie | Postgres (Neon); bez tego PGLite |
| `BETTER_AUTH_SECRET` | zalecane na prod | Sekret sesji |
| `BETTER_AUTH_URL` | zalecane na prod | Publiczny URL aplikacji |

**Nie commituj kluczy.** Dodaj je w Vercel → Project → Settings → Environment Variables.

## Tryby wyszukiwania

- **Auto** — URL lub zapytanie
- **Szukaj** — Wikipedia + DuckDuckGo + scrape top wyników
- **URL** — pełny crawl jednej strony
- **Deep** — multi-page po linkach wewnętrznych

## Licencja

Kod aplikacji — demo / własny projekt. Silniki zewnętrzne mają własne licencje (MIT, Apache-2.0, AGPL itd.).
