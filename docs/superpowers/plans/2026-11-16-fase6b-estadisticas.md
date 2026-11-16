# Phase 6b — Statistics and charts: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user sees who wins, with what scores and how a game evolves (per-game statistics on the game page), and their own record, most-played games and head-to-head against each rival (a personal Statistics page), with accessible charts.

**Architecture:** One migration (0015) adds read-only `security invoker` SQL functions that aggregate by `player_id` (never by name), so RLS decides what is counted. A new `src/features/stats/` holds typed services that call them, pure helpers (win rate, series pivoting, top-N folding) and the UI: server components for the sections, small client components for the charts (shadcn `Chart` over Recharts 3), each with an equivalent table. The category breakdown (Task 6) is the only part computed in TypeScript, because stored scores are raw inputs and points come from the scoring engine.

**Tech Stack:** Next.js 16, TypeScript strict, Zod 4, Supabase (RLS, SQL functions), next-intl (en/es/fr), Tailwind v4 + shadcn (radix-nova) + `recharts@3` via `npx shadcn add chart`, Vitest, Playwright (+ axe).

**Spec:** `docs/superpowers/specs/2026-11-16-fase6-jugadores-estadisticas-design.md` §4 (6b), with §3 players model and §5 decisions.

## Global Constraints

- Before writing any Next.js code read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md). Next 16: wrap every `catch` around `auth()` with `unstable_rethrow`. Read the `dataviz` skill (and its references) **before** writing any chart code; use Context7 for shadcn Chart / Recharts 3 questions.
- The product is generic: never hard-code games or sheets; fixtures in tests are just examples.
- No hard-coded UI strings: everything in `src/i18n/messages/{en,es,fr}.json` with identical keys (`src/i18n/messages.test.ts`). Numbers and dates go through next-intl formatters.
- Never import `cn` from `"cn"` (ADR-016): `npx shadcn add chart` may reintroduce `import { cn } from "cn"` and install the `cn` npm package. Answer "no" to overwriting existing components, `npm uninstall cn` if it appears, fix the import to `@/lib/utils`.
- Group and join by `player_id` only; a player's name is read at display time (renames and merges therefore carry through).
- Statistics count only the signed-in user's own matches (RLS owner-only); functions are `security invoker`, `stable`, `set search_path = ''`, granted to `authenticated` only (revoke from `public`/`anon`). No Docker. **Ask the user before `npx supabase db push`.**
- A player with no recorded total in a match (null) does not count as a scored match, never wins, and never enters averages. Ties: all tied winners win (rank 1), as in 5b.
- Charts follow `dataviz`: one hue for magnitude, categorical colors in fixed order (max 5 series: the tokens `--chart-1..5`; fold the rest into the table, never invent hues), never a dual axis, thin marks, legend for ≥ 2 series, text in text tokens, every chart has a table equivalent, light and dark validated (`validate_palette.js`).
- Client components never import server-only code; chart components receive plain serializable props.
- E2E fixture prefix `9907` (taken: 9900–9906) and test user `m` (add to `TEST_USERS`/`STATE_FILE` in `tests/e2e/helpers.ts`, and to `auth.setup.ts` as the existing users are).
- Commit after each task. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Statistics only ever count the viewer's own matches, and follow renames and merges: after merging two players their wins, averages and head-to-head add up; another user's data never appears. (Task 1, Task 4)
2. Empty and degenerate data renders sensibly, never NaN, "undefined" or a blank chart: a game with no matches, matches where nobody has a score, a single match, a single player, everyone tied, the same date for several matches, negative scores, 12 players (chart caps at 5 series, the table shows all). (Task 2, Task 4)
3. No "me" yet: the personal page explains why head-to-head needs it and links to "My players" instead of showing zeros; a rival who never shared a match with me does not appear; ties are counted as ties. (Task 1, Task 5)
4. Accessibility and locale: every chart has the table equivalent, a legend and an accessible name, is keyboard-reachable, passes axe in light and dark, fits a 375 px phone without horizontal page scroll, and numbers/dates read correctly in es and fr. (Task 3, Task 4, Task 5)
5. Size and speed: a user at the 5 000-match cap still gets a bounded payload (the evolution series is limited to the latest N matches of the game), one round trip per section, no per-row queries. (Task 1, Task 4)

---

## File Structure

```
supabase/migrations/20261116180000_stats.sql
tests/integration/rls-stats.test.ts
src/components/ui/chart.tsx                      (shadcn, adjusted)
src/features/stats/
  index.ts                  (server-safe barrel)    client.ts (chart components for client use)
  schemas.ts                (Zod parsers of the RPC rows)
  format.ts + format.test.ts            (win rate, top-N folding, series pivot)
  services/stats-service.ts             (getGameStats, getMyStats, getGameCategoryStats)
  components/game-stats.tsx             (server section on the game page)
  components/wins-chart.tsx, score-evolution-chart.tsx   ("use client")
  components/chart-table.tsx            (the accessible table equivalent)
  components/my-stats.tsx, head-to-head.tsx, category-table.tsx
src/app/[locale]/(app)/stats/page.tsx
src/app/[locale]/(app)/games/[id]/page.tsx       (modify: add the statistics section)
src/components/layout/app-nav.tsx                (modify: Statistics item)
src/i18n/messages/{en,es,fr}.json                (Stats.*, Nav.stats)
tests/e2e/app-stats.spec.ts, tests/e2e/helpers.ts (user m)
docs/ROADMAP.md, DATABASE.md, DECISIONS.md (ADR-035)
```

---

### Task 1: Statistics SQL functions (migration 0015)

**Files:**
- Create: `supabase/migrations/20261116180000_stats.sql`, `tests/integration/rls-stats.test.ts`
- Modify: `docs/DATABASE.md` (new subsection, migration list)

**Interfaces:**
- Produces (all `security invoker stable`, `execute` only to `authenticated`):
  - `game_stats(p_game_id uuid)` → `(player_id uuid, name text, plays int, scored_plays int, wins int, avg_score numeric, best_score int)`, one row per player who took part in a match of that game, ordered `wins desc, scored_plays desc, name`.
  - `game_summary(p_game_id uuid)` → one row `(plays int, avg_duration_minutes numeric, first_played_on date, last_played_on date)` (`avg` null when no durations; zeros/nulls when no matches).
  - `game_score_series(p_game_id uuid, p_limit int default 100)` → `(play_id uuid, seq int, played_on date, player_id uuid, name text, total int)`: scored participants of the **latest `p_limit` matches** (capped at 200), `seq` = 1..N in chronological order (`played_on`, `created_at`).
  - `my_overview()` → one row `(me_player_id uuid, plays int, scored_plays int, wins int, games_played int)`; `me_player_id` null and zeros when no "me".
  - `my_top_games(p_limit int default 5)` → `(game_id uuid, name text, plays int, wins int)` for matches the "me" player took part in, ordered `plays desc, wins desc, name`.
  - `head_to_head()` → `(player_id uuid, name text, plays_together int, my_wins int, their_wins int, ties int)`; only matches where "me" and the rival both have a rank; rivals sharing no match are absent; empty when no "me".

- [ ] **Step 1: Write `rls-stats.test.ts` first** (pattern of `rls-players.test.ts`: privileged setup, `asA(...)` for the user). Fixture: user A with a "me" player and rivals Ana/Bo, a game with 4 matches (a tie, a match with null totals, two on the same day, one with a negative total), another game with 1 match; user B with a match of their own. Tests: `game_stats` numbers exactly (plays, scored_plays, wins incl. tie, avg, best incl. negative); null-total participants count in `plays` but not in `scored_plays`/averages and never win; `game_summary` with and without durations and for a game with no matches; `game_score_series` ordering/`seq`, the `p_limit` bound (and clamp above 200); `my_overview`/`my_top_games`/`head_to_head` numbers incl. tie and a rival who only played without "me" being absent; **no "me" → empty/zeros**; **after `merge_players` the numbers add up** (same player id, new name); user B never sees A's rows and A never sees B's; a function called with a non-existing/foreign game id returns empty, not an error; `anon` cannot execute any of them.
- [ ] **Step 2: Run it to see it fail** — `npm run test:integration -- tests/integration/rls-stats.test.ts`. Expected: FAIL (functions do not exist).
- [ ] **Step 3: Write the migration** with the six functions above (plain SQL/`language sql`, `security invoker`, `stable`, `set search_path = ''`, fully-qualified names, `revoke all … from public, anon; grant execute … to authenticated`). Win rate is **not** computed in SQL. Game names come from `public.games` (RLS decides visibility). Rehearse the file first in a rolled-back transaction against dev, then **ask the user before `supabase db push`** and apply.
- [ ] **Step 4: Run the new tests and the whole integration suite.** Expected: PASS, no regression (179 + new).
- [ ] **Step 5: Docs and commit** — DATABASE.md describes the functions and the "latest N matches" bound; commit `feat(db): statistics functions`.

---

### Task 2: Stats service, schemas and pure helpers

**Files:**
- Create: `src/features/stats/{schemas.ts,format.ts,format.test.ts,services/stats-service.ts,index.ts}`

**Interfaces:**
- Consumes: Task 1 functions via `createSupabaseServerClient().rpc(...)`.
- Produces:
  - Types `PlayerStat {playerId, name, plays, scoredPlays, wins, avgScore: number | null, bestScore: number | null}`, `GameSummary`, `SeriesPoint {playId, seq, playedOn, playerId, name, total}`, `MyOverview`, `TopGame`, `Rival`.
  - `getGameStats(gameId: string): Promise<{ summary: GameSummary; players: PlayerStat[]; series: SeriesPoint[] }>` (three parallel RPCs; invalid uuid → empty result, never throws on bad id; unexpected DB errors throw).
  - `getMyStats(): Promise<{ overview: MyOverview; topGames: TopGame[]; rivals: Rival[] }>`.
  - Pure: `winRate(wins: number, scoredPlays: number): number | null` (null when 0 scored), `topSeriesPlayers(players: PlayerStat[], max = 5): string[]` (player ids by `plays` desc, stable tie-break by name then id; they keep their color for the whole page), `pivotSeries(points: SeriesPoint[], playerIds: string[]): { seq: number; playedOn: string; [playerId: string]: number | string | null }[]` (one row per `seq`, `null` where that player did not play or had no score, so lines show gaps instead of zeros).

- [ ] **Step 1: Write `format.test.ts`** with the exact cases: `winRate(3, 4) = 0.75`, `winRate(0, 0) = null` (not NaN), `winRate(1, 1) = 1`; `topSeriesPlayers` with 7 players returns 5 in plays-desc order, ties broken by name then id, fewer than 5 returns all, empty returns `[]`; `pivotSeries` gaps are `null`, two points on one `seq` merge into one row, an unlisted player is dropped, negative totals kept, output ordered by `seq`.
- [ ] **Step 2: Run to see it fail** — `npx vitest run src/features/stats`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `format.ts`, Zod row parsers in `schemas.ts` (numerics arrive as strings from Postgres `numeric`: parse to number; a row that fails parsing throws), and the services.
- [ ] **Step 4: Run unit suite, lint, typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(stats): services and pure helpers`.

---

### Task 3: Chart foundation (shadcn Chart over Recharts 3)

**Files:**
- Create: `src/components/ui/chart.tsx` (via `npx shadcn add chart`), `src/features/stats/components/{wins-chart.tsx,score-evolution-chart.tsx,chart-table.tsx,client.ts}`
- Modify: `package.json` (only `recharts` added), `src/app/globals.css` (`--chart-N` only if the validator demands), `docs/DECISIONS.md` (ADR-035)

**Interfaces:**
- Produces (client components, serializable props):
  - `<WinsChart data={{ playerId; name; wins; scoredPlays }[]} labels={{ title; wins; ... }} />`: ranked **horizontal bars** of wins per player, one hue (`--chart-1`), value labels on the bar ends, ≥ 44 px row height on touch.
  - `<ScoreEvolutionChart rows={ReturnType<typeof pivotSeries>} players={{ id; name }[]} labels={...} />`: multi-line, one line per player (≤ 5), colors in the fixed order of `players`, 2 px lines, ≥ 8 px markers, gaps for `null`, x axis = match number, tooltip shows date and each score, legend always, `accessibilityLayer` on.
  - `<ChartTable caption columns rows />`: the semantic `<table>` shown in a `<details>` ("Show as table") under each chart, with the same numbers.
  - `ChartFrame`-style wrapper sets `role="img"`-free structure: the chart has an accessible name (`aria-label` from `labels.title`) and the table is the text alternative.

- [ ] **Step 1: Read `dataviz` and its references, then validate the palette**: convert the light and dark `--chart-1..5` oklch values to hex (script in the scratchpad) and run `node <skill>/scripts/validate_palette.js "<hex,...>" --mode light|dark`. Record the report in the PR notes. If a check FAILs, adjust only the failing tokens (smallest change) and re-run; if a contrast WARN remains, the table view and direct labels are mandatory (they are).
- [ ] **Step 2: `npx shadcn add chart`**, then undo the known side effects (ADR-016 `cn`, no overwrite of existing ui files), `npm ls recharts` shows 3.x; read the generated `chart.tsx` once.
- [ ] **Step 3: Build the components** over fixed fixture props in a throwaway local page (not committed) to look at them at 375 px and desktop, light and dark, with 1 player, 5 players and long names ("render and look" step from `dataviz`).
- [ ] **Step 4: Write a Vitest test for `chart-table`'s row/number formatting helper if one is extracted; otherwise rely on Task 4's E2E.** Run lint, typecheck, build. Expected: PASS (no hydration warnings).
- [ ] **Step 5: ADR-035** (chart library choice, tokens, no hand-written charts, ledger of palette validation) and commit — `feat(stats): chart foundation`.

---

### Task 4: Per-game statistics on the game page

**Files:**
- Create: `src/features/stats/components/game-stats.tsx`, `tests/e2e/app-stats.spec.ts`
- Modify: `src/app/[locale]/(app)/games/[id]/page.tsx` (fetch `getGameStats` in the existing `Promise.all`; render the section below `playsPanel` via a new `statsPanel` slot of `GameDetailView`), `src/features/catalog` (the slot), `src/i18n/messages/*.json`, `tests/e2e/helpers.ts`, `tests/e2e/auth.setup.ts`

**Interfaces:**
- Consumes: `getGameStats`, `winRate`, `topSeriesPlayers`, `pivotSeries`, the chart components.
- Produces: `<GameStats data />` server component: renders nothing when the game has no matches; otherwise a "Statistics" section with (1) a row of stat tiles: matches, average duration (hidden when none), last played; (2) a per-player table (matches, wins, win %, average, best) sorted as the SQL returns; (3) `WinsChart` (hidden when nobody has a win); (4) `ScoreEvolutionChart` (hidden when fewer than 2 matches have scores) for the top ≤ 5 players, plus a note when more players exist ("Charts show the 5 most frequent players; the table lists everyone"); each chart with its table.

- [ ] **Step 1: Write the E2E spec first** (`app-stats.spec.ts`, user `m`, fixtures via the DB like `app-players.spec.ts`): game with 4 matches → the section shows the exact per-player numbers (wins, win %, average, best) in en; after **merging two players in My players** the table shows one combined row with summed wins; a game with matches but no scores shows the table without charts and no "NaN"; a second game with no matches shows no statistics section; 7 players → the chart legend has 5 and the table has 7 plus the note; keyboard: the "Show as table" toggles open with Enter; no horizontal page scroll at 375 px (mobile project); axe light and dark (as `app-plays.spec.ts` does); es and fr render localized numbers (decimal comma) and dates; user `l`'s data never appears for `m`.
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL (no section).
- [ ] **Step 3: Implement** the section, the slot, the messages (en/es/fr, plural-aware), the helpers/auth setup for user `m`.
- [ ] **Step 4: Run lint, typecheck, unit, the new E2E, then the full E2E suite.** Expected: all PASS.
- [ ] **Step 5: Commit** — `feat(stats): per-game statistics`.

---

### Task 5: Personal Statistics page and navigation

**Files:**
- Create: `src/app/[locale]/(app)/stats/page.tsx`, `src/features/stats/components/{my-stats.tsx,head-to-head.tsx}`
- Modify: `src/components/layout/app-nav.tsx` (add `{ href: "/stats", key: "stats", icon: BarChart3 }`; the bottom bar grid becomes `grid-cols-5`), `src/i18n/messages/*.json` (`Nav.stats`, `Stats.*`), `tests/e2e/app-stats.spec.ts`, `tests/e2e/app-layout.spec.ts` (nav now has 5 items), `docs/ROADMAP.md`, `docs/DATABASE.md`

**Interfaces:**
- Consumes: `getMyStats`, `winRate`.
- Produces: page `/stats` (`<MyStats overview topGames rivals />`): without "me" → an explanation card and a link to "My players" (no zeros); with "me" → tiles (matches, wins, win %, games played), "Most played games" ranked bars (each a link to the game, plus its table), and **head-to-head**: one row per rival with matches together, my wins, their wins, ties and a thin segmented bar (no text on it; the numbers are in the row), ordered by matches together; with "me" but no matches → empty state with a link to log one.

- [ ] **Step 1: Extend the E2E spec**: no "me" → explanation + link, no head-to-head; mark "me" → numbers exact (wins, win %, top games order, one rival with a tie, a rival who never shared a match absent); empty state; nav item active on `/stats`, bottom bar fits 5 items at 375 px in es/fr (no truncation or overlap); axe light/dark; keyboard order; another user's data never appears.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL (route 404).
- [ ] **Step 3: Implement** page, components, nav, messages (read the Next 16 docs for page conventions; `setRequestLocale` as the other pages do).
- [ ] **Step 4: Run lint, typecheck, unit, the full E2E suite (update `app-layout.spec.ts` as needed).** Expected: all PASS.
- [ ] **Step 5: Update ROADMAP/DATABASE and commit** — `feat(stats): personal statistics and head-to-head`.

---

### Task 6: Category breakdown per game (engine-computed)

Separable: if cut, 6b is complete without it (the spec's "desglose por categoría cuando hay hoja").

**Files:**
- Create: `src/features/stats/category-breakdown.ts` + `.test.ts`, `src/features/stats/components/category-table.tsx`
- Modify: `src/features/stats/services/stats-service.ts` (`getGameCategoryStats`), `game-stats.tsx`, messages, `tests/e2e/app-stats.spec.ts`

**Interfaces:**
- Consumes: `evaluate` (`@/features/scoring/engine/evaluate`, `CategoryResult {key, points}`), `validateDefinition`.
- Produces: pure `categoryAverages(plays: { versionId; definition: unknown; participants: { playerId; values: Record<string, ScoreValue> }[] }[]): { versionId; categories: { key; label }[]; rows: { playerId; averages: Record<string, number> }[] } | null` for the **sheet version used by most matches of the game** (ties: the newest version); matches on other versions are ignored and the section says how many were left out. `getGameCategoryStats(gameId)` fetches plays with `scoring_sheet_versions(id, definition)` and `play_scores`, bounded to the latest 200 matches, definitions validated (an invalid stored definition ⇒ section hidden, logged).
- UI: a **table** (players × categories, average points, thin bar per cell scaled per category), because categories are many and carry meaning (dataviz: table over more colors).

- [ ] **Step 1: Write `category-breakdown.test.ts`** with the cases: two players over three matches on one version give exact averages; a missing value counts as 0 points (engine rule) only for matches that used that version; plays on another version are excluded and counted; an invalid definition returns `null` (never throws); no sheet matches → `null`; ties on version count pick the newest; labels come from the definition.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement** the pure function, service and table; wire into `GameStats` below the charts (hidden when `null`).
- [ ] **Step 4: Extend the E2E**: a game played with a sheet of ≥ 3 categories shows the table with the exact averages; a game with manual totals shows no category section.
- [ ] **Step 5: Run everything and commit** — `feat(stats): category breakdown`.

---

### Task 7: Docs and wrap-up

**Files:** `docs/ROADMAP.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/DECISIONS.md`

- [ ] **Step 1:** ROADMAP "Estado de la Fase 6b" table with the final counts; SECURITY: the functions are `security invoker`, owner-only through RLS, `anon` cannot execute them; DECISIONS: confirm ADR-035 text matches what shipped.
- [ ] **Step 2: Run the full verification** (`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, integration, full E2E). Expected: all PASS.
- [ ] **Step 3: Commit** — `docs: Phase 6b`.
