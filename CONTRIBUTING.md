# Contributing to Amika

Thanks for wanting to help! Bug reports, translations, score sheets, features and docs are all welcome.
By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug or propose a feature**: open an [issue](../../issues/new/choose) using one of the templates.
- **Translate**: UI strings live in `src/i18n/messages/{en,es,fr,pt}.json`. Improving a translation or adding a
  new language is a great first contribution.
- **Fix or build something**: look for issues labelled `good first issue` or `help wanted`. For anything bigger
  than a small fix, comment on the issue (or open one) first so we can agree on the approach before you write code.

Issues and pull requests can be written in **English or Spanish**.

## Development setup

Follow [Getting started](README.md#getting-started) in the README. In short you need Node.js 24, your own
**Clerk** development instance and your own **Supabase** project (both have free tiers). Never use or ask for
the maintainer's keys.

Optional services (BoardGameGeek token, Brave Search key) are only needed for catalog import and the manual
finder; the rest of the app works without them.

## Workflow

1. Fork the repository and create a branch from `main`:
   `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, `chore/<short-name>`.
2. Make your change, with tests.
3. Run the same checks CI runs:
   ```bash
   npm run format:check
   npm run lint
   npm run typecheck
   npm test
   ```
   If you touched the database, also run `npm run test:integration` against your own Supabase project.
   If you touched a user flow, run `npm run e2e` (needs Clerk dev keys).
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat(plays): ...`, `fix(catalog): ...`, `docs: ...`, `refactor(stats): ...`.
5. Open a pull request against `main` and fill in the template. Keep PRs focused: one change per PR.

## Code guidelines

- **TypeScript strict**, no unjustified `any`.
- **Server Components by default**; add `"use client"` only where interaction needs it.
- **Business code goes in `src/features/<module>`** and is consumed through that module's `index.ts`.
  Don't import a module's internals from another module.
- **No hard-coded UI text.** Every string goes through next-intl and must exist in all locale files
  (`src/i18n/messages.test.ts` checks this).
- **Security in two layers**: check permissions in the Server Action / Route Handler **and** enforce them with
  Row Level Security. Hiding a button never protects an operation. See [`docs/SECURITY.md`](docs/SECURITY.md).
- **Database changes** only through a new file in `supabase/migrations/`, with RLS tests in `tests/`.
  Regenerate types with `npm run db:types`. Never change the schema from the Supabase dashboard.
- **Accessibility**: keyboard navigation, labels for screen readers, AA contrast in light and dark themes,
  touch targets of at least 44 px.
- **Every view handles loading, empty, error and success states.**
- Big design choices are recorded as ADRs in [`docs/DECISIONS.md`](docs/DECISIONS.md). If your change makes
  one, add an entry.

## Third-party content

Amika shows data from BoardGameGeek and links to publishers' manuals. Don't commit copyrighted material
(rulebooks, cover images, BGG data dumps) to the repository: link to official sources instead.

## Security

Please don't report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
