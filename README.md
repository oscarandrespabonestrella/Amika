# Amika

Web app to manage your board game collection, log plays and see stats.
Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · shadcn/ui (Radix) · next-intl (en, es, fr) · Clerk (auth) · Supabase (Postgres + RLS + Storage).

Product, architecture, data model and security decisions live in [`docs/`](docs/) — start with
[`PRODUCT_SPEC`](docs/PRODUCT_SPEC.md), [`ARCHITECTURE`](docs/ARCHITECTURE.md) and [`DECISIONS`](docs/DECISIONS.md).

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in (never commit .env.local)
npm run dev                  # http://localhost:3000
```

Required variables are listed in [`.env.example`](.env.example). Clerk must also be connected to Supabase
as a third-party auth provider (see `docs/SECURITY.md` §2).

## Scripts

| Command                                       | What it does                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build`                       | Run / build the app                                                                                           |
| `npm run lint` · `typecheck` · `format:check` | Static checks                                                                                                 |
| `npm test`                                    | Unit tests (Vitest, offline)                                                                                  |
| `npm run test:integration`                    | RLS tests against the Supabase **dev** database (rolled back)                                                 |
| `npm run e2e`                                 | Playwright (needs Clerk dev keys; skipped otherwise). `E2E_BASE_URL=https://...` runs it against a deployment |
| `npm run admin:grant -- <email>`              | Grants the administrator role (verified Clerk e-mail required; `--revoke` removes it)                         |
| `npm run db:types`                            | Regenerate `src/lib/supabase/database.types.ts`                                                               |

Database changes go through `supabase/migrations/` (`supabase db push`), never through the dashboard.

## Layout

`src/app` routes · `src/features/<module>` business modules (public API = `index.ts`) · `src/components` shared UI ·
`src/lib` infrastructure · `src/i18n` locales and messages · `supabase/` migrations · `tests/` integration + e2e.
