# Phase 5b — Matches (plays): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a game's page, a user can log, view, edit and delete a match: date, duration, notes, base-game expansions, up to 12 players by name, and points per player either through one of their score sheets (server-recomputed totals) or as a manual total, with ranks and winners (ties all win).

**Architecture:** New feature module `src/features/plays` (pure `compute.ts`, services/actions/components like `library` and `scoring`). Four new tables with RLS, written atomically by an invoker SQL function `save_play(jsonb)`. The browser computes live totals with the same `evaluate` engine, but the server recomputes everything before saving and ignores any client-sent total, rank or winner.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), TypeScript strict, Zod 4, Supabase (RLS, Clerk third-party auth), next-intl (en/es/fr), Tailwind v4 + shadcn (radix-nova), Vitest, Playwright, `pg` RLS tests.

**Spec:** `docs/superpowers/specs/2026-11-16-fase5-partidas-puntuacion-design.md` §8–9 (delivery 2; includes the 2026-11-16 addendum: entry only from the game page).

## Global Constraints

- Before writing any Next.js code read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md). Next 16: `proxy.ts`; wrap every `catch` around `auth()` with `unstable_rethrow`.
- No hard-coded UI strings: everything in `src/i18n/messages/{en,es,fr}.json` with identical keys (parity enforced by `src/i18n/messages.test.ts`). Validation/engine errors are stable **codes** the UI translates.
- Never import `cn` from `"cn"` (ADR-016). Touch targets ≥ 44 px; labels on every control; axe (wcag2a/aa/21aa/22aa) clean in light and dark.
- Matches are the **creator's own**: RLS "only `created_by`" on `plays` and every child table. Players are free-text names (max 12 per match, name 1–60 chars, trimmed); no user linking (Phase 8). No match photos (Phase 7). No statistics (Phase 6).
- Totals, ranks and winners are computed by the server with `validateDefinition` + `evaluate` from `@/features/scoring`; the highest total wins; ties: every tied player is a winner; if nobody has a recorded score, nobody wins.
- A match's sheet is fixed once created (changing sheet = a new match). It stores the **version id** it used (`scoring_version_id`, FK `no action`, nullable = manual totals).
- Limits (my calls, from the spec's spirit): ≤ 12 participants, ≤ 20 expansions per match, ≤ 5 000 matches per user, notes ≤ 2 000, duration 1–1 440 minutes, manual total and each numeric value integers within ±1 000 000.
- Definitions and stored values are untrusted: users can write rows directly through PostgREST (see `docs/DATABASE.md` §8). Re-validate on read; the DB adds CHECKs and triggers.
- No Docker; RLS tests run against the Supabase dev DB (`tests/integration/db.ts`). Applying a migration to dev (`npx supabase db push`) needs the user's go-ahead each time: ask first.
- E2E fixture prefix `9904` (taken: 9900 games, 9901 library, 9902 game-center, 9903 scoring) and a new test user `h`.
- Commit after each task. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Totals, ranks or winners sent by the client (or values for categories not on the sheet) are ignored or rejected; the server's numbers are what get stored. (Task 1, Task 3)
2. A match that points at a sheet version the user cannot see (another user's private sheet) or at a game they cannot see is refused. (Task 2, Task 3)
3. Nobody scored / everybody at 0 / negative totals / a blank player among scored ones: no phantom winners, ranks follow "1, 1, 3, 4" competition ranking. (Task 1)
4. Deleting a sheet that has matches gives a clear "in use" message, not a 500; deleting an account, a game or a profile still cascades cleanly (the version FK must not block it). (Task 2, Task 3)
5. Player names: duplicates allowed, emoji, 60 chars exactly, 61 rejected, markup shown as plain text, padding trimmed, 13th player refused. (Task 1, Task 4, Task 5)

---

## File Structure

```
src/features/plays/
  schemas.ts                 PLAY_LIMITS, createPlaySchema, updatePlaySchema, playIdSchema (+ test)
  compute.ts                 rankTotals(), computePlay() — pure, no server-only (+ test)
  services/play-service.ts   server-only DB access (RLS client)
  actions/play-actions.ts    "use server"
  components/                play-form.tsx, plays-panel.tsx
  index.ts
supabase/migrations/20261116130000_plays.sql
tests/integration/rls-plays.test.ts
tests/e2e/app-plays.spec.ts
src/app/[locale]/(app)/games/[id]/plays/new/page.tsx
src/app/[locale]/(app)/games/[id]/plays/[playId]/page.tsx
```
Modified: `src/features/scoring/services/sheet-service.ts` (+`versionId` on `SheetDetail`, `listSheetOptions`, `deleteSheet` → `"in_use"`), `src/features/scoring/actions/sheet-actions.ts` (+`in_use`), `src/features/scoring/components/sheets-list.tsx` (shows it), `src/features/scoring/index.ts`, `src/features/catalog/components/game-detail.tsx` (slot `playsPanel`), `src/app/[locale]/(app)/games/[id]/page.tsx`, messages, `tests/e2e/helpers.ts` + `auth.setup.ts` (user `h`), docs.

---

### Task 1: Pure computation (ranking, totals) and input schemas

**Files:**
- Create: `src/features/plays/compute.ts`, `src/features/plays/schemas.ts`
- Test: `src/features/plays/compute.test.ts`, `src/features/plays/schemas.test.ts`

**Interfaces:**
- Consumes: `evaluate`, `ScoreValue`, `FieldErrorCode` from `@/features/scoring/engine/evaluate`; `validateDefinition`, `Definition` from `@/features/scoring/engine/*`; `KEY_PATTERN`, `SCORE_LIMITS` from `@/features/scoring/engine/definition`.
- Produces:
  - `rankTotals(totals: readonly (number | null)[]): { rank: number | null; isWinner: boolean }[]` — competition ranking over non-null totals (descending); `null` → `{rank:null,isWinner:false}`; rank 1 = winner.
  - `type ParticipantInput = { name: string; values?: Record<string, ScoreValue | undefined>; manualTotal?: number | null }`
  - `type ParticipantResult = { name: string; seat: number; total: number | null; rank: number | null; isWinner: boolean; scores: Record<string, ScoreValue>; errors: Record<string, FieldErrorCode> }`
  - `type PlayComputation = { ok: boolean; participants: ParticipantResult[]; invalidDefinition?: true }`
  - `computePlay(definition: unknown | null, participants: readonly ParticipantInput[]): PlayComputation` — `definition === null` means manual totals.
  - `PLAY_LIMITS = { maxParticipants: 12, maxName: 60, maxNotes: 2000, maxExpansions: 20, maxDuration: 1440, maxManualTotal: 1_000_000 }`
  - `createPlaySchema` = strict `{ gameId: uuid; playedOn: ISO date `YYYY-MM-DD`; durationMinutes: int 1..1440 | null; sheetId: uuid | null; notes: trimmed ≤2000 | null; expansionIds: uuid[] (≤20, unique); participants: ParticipantInput-shaped[] (1..12; `values`: record of key-pattern → unknown; `manualTotal`: int ±1e6 | null) }`; `updatePlaySchema` = the same without `sheetId`/`gameId`, with `playId: uuid`; `playIdSchema = z.uuid()`. Error messages are codes (`required`, `tooLong`, `invalidDate`, `outOfRange`).

Rules for `computePlay`: with a definition → `validateDefinition` first (invalid → `{ ok:false, participants:[], invalidDefinition:true }`); each participant's `values` are reduced to keys that exist on the sheet and are defined (the rest are dropped); a participant with **no defined values has `total: null`**; otherwise `total = evaluate(...).total` and field errors go to `errors` (`ok:false`, total stays the engine's finite integer). Without a definition → `total = manualTotal ?? null`, `scores = {}`; a manual total outside ±1e6 or non-integer is an error under key `"manual"` (`invalid`/`outOfRange`). Ranks via `rankTotals`; `seat` = index.

- [ ] **Step 1: Write failing tests.** `compute.test.ts`: `rankTotals: [10,8,10,5] → ranks 1,3,1,4 and winners T,F,T,F`; `[null,null] → no rank, no winner`; `[0,0] → both rank 1 and winners`; `[5,null] → 1 and null, first wins`; `[-3,-5] → 1,2`; `[] → []`; `[7] → rank 1 winner`. `computePlay`: `7 Wonders fixture (SEVEN_WONDERS): player A with the 62-point entry from the scoring tests and player B with {military: 3} → totals 62 and 3, A wins` (import the fixture and values from `@/features/scoring/engine/fixtures`); `a participant without values has total null and is not ranked` ; `nobody has values → nobody wins`; `values for keys not on the sheet are dropped from scores (Review Focus 1)`; `a bad value (1.5) → errors[key]='invalid', ok=false, total finite`; `an invalid/cyclic definition → invalidDefinition`; `manual totals: [12, 12, null] → both rank 1 winners, third unranked`; `manual total 1.5 or 2_000_000 → errors.manual`; `seat equals the index`. `schemas.test.ts`: valid create payload; trims name and notes; `61-char name rejected, 60 accepted`; `13 participants rejected, 12 accepted, 0 rejected`; `emoji and markup in a name accepted as plain text`; `duplicate names accepted`; `bad dates ("2026-13-40", "yesterday", "") rejected`; `duration 0 and 1441 rejected, null accepted`; `duplicate or 21 expansion ids rejected`; `extra keys (total, rank, isWinner) rejected (strict)` (Review Focus 1); `update schema requires playId and has no sheetId`.
- [ ] **Step 2: Run** `npx vitest run src/features/plays` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `compute.ts` and `schemas.ts` per the interfaces. Route code for the date: `z.iso.date()` with message `invalidDate`.
- [ ] **Step 4: Run** `npx vitest run src/features/plays && npx eslint src/features/plays` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(plays): ranking, totals and input schemas`.

---

### Task 2: Migration, RLS and `save_play`

**Files:**
- Create: `supabase/migrations/20261116130000_plays.sql`, `tests/integration/rls-plays.test.ts`
- Modify: `src/lib/supabase/database.types.ts` (`npm run db:types`)

**Interfaces:**
- Produces tables (RLS on, `revoke all … from anon`):
  - `plays(id uuid pk, created_by text not null default current_user_id() → profiles on delete cascade, game_id → games on delete cascade, played_on date not null default current_date, duration_minutes smallint check (null or 1..1440), scoring_version_id uuid → scoring_sheet_versions (no action), notes text check (null or ≤2000), created_at, updated_at)`; indexes `(created_by, game_id, played_on desc)`, `(game_id)`, `(scoring_version_id) where not null`; `set_updated_at` trigger.
  - `play_participants(id uuid pk, play_id → plays on delete cascade, seat smallint check 0..11, display_name text check 1..60, total_score integer check ±1e9 | null, rank smallint check ≥1 | null, is_winner boolean not null default false, unique (play_id, seat))`.
  - `play_scores(participant_id → play_participants on delete cascade, category_key text check ~ '^[a-z][a-z0-9_]{0,29}$', value jsonb check octet_length(value::text) ≤ 500, primary key (participant_id, category_key))`.
  - `play_expansions(play_id → plays on delete cascade, game_id → games on delete cascade, primary key (play_id, game_id))`.
- Triggers: ≤ 5 000 plays per `created_by`; ≤ 12 participants per play; ≤ 20 expansions per play (all `P0001`).
- Policies: `plays` select/update/delete own; insert own **and** the game visible **and** (`scoring_version_id is null or the version is visible` — RLS on versions makes it "own sheets only"). Children: all operations iff the parent play is visible (own). `play_expansions` insert also requires the game visible and `kind = 'expansion'`.
- `public.save_play(p jsonb) returns uuid` — `security invoker`, `set search_path = ''`, executable by `authenticated` only. `p` = `{ playId?: uuid, gameId, playedOn, durationMinutes, scoringVersionId, notes, expansionIds: uuid[], participants: [{ seat, name, total, rank, isWinner, scores: { <key>: <json> } }] }`. Create when `playId` is absent; otherwise update that play's own fields (`scoringVersionId` and `gameId` are not changed on update), replace its participants/scores/expansions, and raise `P0002` when the play is not visible. Everything in one transaction.

- [ ] **Step 1: Write failing tests** (pattern: `rls-scoring.test.ts`; users `test_user_a/b`; fixtures: profiles, a global game, a global expansion, B's custom game, A's sheet + version, B's sheet + version): `a user only sees their own plays and children`; `anonymous has no access (42501 on tables and on save_play)`; `created_by defaults to the caller and cannot be spoofed`; `cannot log a match for a game the user cannot see` (B's custom game, as A); `cannot reference another user's sheet version (Review Focus 2)`; `can reference an own version or none`; `save_play creates a play with participants, scores and expansions atomically`; `save_play with a bad child (13th participant) rolls everything back (no orphan play)`; `save_play with playId replaces children and keeps the version`; `save_play on someone else's play raises P0002`; `an expansion child must be an expansion of a visible game`; `seat/name/total/rank/value-size CHECKs (23514)`; `duplicate seat → 23505`; `caps: 21st expansion, 13th participant, 5001st play (P0001)`; `deleting a sheet that has plays is refused (23503)` and `deleting a sheet without plays still works`; `deleting a profile, a game, or a play cascades cleanly even when the user's plays reference the user's own sheet versions (Review Focus 4)`; `a user cannot update or delete another user's play (rowCount 0)`.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/rls-plays.test.ts` — Expected: FAIL (tables missing).
- [ ] **Step 3: Write the migration** per the interfaces, in the style of `20261116100000_scoring_sheets.sql`.
- [ ] **Step 4: Ask the user before applying** (`AskUserQuestion`: "Apply migration 20261116130000_plays.sql to the Supabase dev project?"). On yes: `npx supabase migration list` (only this one pending), `npx supabase db push`, `npm run db:types`.
- [ ] **Step 5: Run** the new tests and then `npm run test:integration` — Expected: PASS; previous 101 still pass.
- [ ] **Step 6: Commit** `feat(db): plays, participants, scores and save_play with RLS`.

---

### Task 3: Services and actions (plus "sheet in use")

**Files:**
- Create: `src/features/plays/services/play-service.ts`, `src/features/plays/actions/play-actions.ts`, `src/features/plays/index.ts`
- Modify: `src/features/scoring/services/sheet-service.ts`, `src/features/scoring/actions/sheet-actions.ts`, `src/features/scoring/components/sheets-list.tsx`, `src/features/scoring/index.ts`, `src/i18n/messages/{en,es,fr}.json` (`Scoring.errors.in_use`)
- Test: `src/features/plays/schemas.test.ts` already covers the envelope; add `src/features/scoring/sheet-in-use.test.ts` only if a pure helper emerges (otherwise covered by Task 5 E2E)

**Interfaces:**
- Consumes: `computePlay`, `createPlaySchema`, `updatePlaySchema` (Task 1); `save_play` and the tables (Task 2); `validateDefinition`, `Definition` (scoring).
- Produces (scoring changes): `SheetDetail` gains `versionId: string`; `type SheetOption = { id: string; title: string; locale: string; version: number; versionId: string; definition: Definition; updatedAt: string }`; `listSheetOptions(gameId: string): Promise<SheetOption[]>` (own sheets of the game, latest version each, definitions revalidated, invalid ones dropped and logged, most recently updated first); `deleteSheet(sheetId): Promise<"deleted" | "in_use">` (`23503` → `in_use`); `deleteSheetAction` returns `{ ok:false, error:"in_use" }` and `ScoringResult` error union gains `"in_use"`; `SheetsList` shows `errors.in_use`.
- Produces (plays service, `server-only`, RLS client):
  - `type PlaySummary = { id: string; playedOn: string; durationMinutes: number | null; sheetTitle: string | null; participants: { name: string; total: number | null; rank: number | null; isWinner: boolean }[] }`
  - `type PlayDetail = PlaySummary & { gameId: string; notes: string | null; expansionIds: string[]; sheet: { versionId: string; version: number; sheetId: string; definition: Definition } | null; entries: { name: string; manualTotal: number | null; values: Record<string, ScoreValue> }[] }`
  - `listPlaysForGame(gameId: string, limit?: number): Promise<PlaySummary[]>` (default 20, newest `played_on` then `created_at` first)
  - `getPlay(playId: string): Promise<PlayDetail | null>` (null when missing, not visible, or the stored sheet definition fails validation — logged)
  - `getPlayDefaults(gameId: string): Promise<{ defaultSheetId: string | null }>` — the sheet of the user's latest match for that game that has one, else the most recently updated sheet of the game, else null
  - `createPlay(input: CreatePlayInput): Promise<{ playId: string } | "invalid" | "not_found" | "limit">`; `updatePlay(input: UpdatePlayInput): Promise<{ playId: string } | "invalid" | "not_found">`; `deletePlay(playId: string): Promise<void>`
  - `createPlay`: if `sheetId` is set, `getSheet` (own, valid) → its `definition` and `versionId`; unknown/not owned → `"not_found"`. Run `computePlay`; `!ok` → `"invalid"`. Build the `save_play` payload from the **server's** results (never from client totals) and call the RPC. Map `42501`/`23503` → `not_found`, `P0001` → `limit`, `P0002` → `not_found`. `updatePlay` loads `getPlay` first to reuse its stored sheet/definition.
- Produces (actions, frame as `sheet-actions.ts`): `type PlayResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: "unauthenticated" | "invalid" | "not_found" | "limit" | "failed" }`; `createPlayAction(input: unknown): Promise<PlayResult<{ playId: string }>>`, `updatePlayAction(input: unknown)`, `deletePlayAction(playId: unknown)`; each: `auth()` → Zod parse → service → `revalidatePath("/", "layout")`; `unstable_rethrow` in `catch`.

- [ ] **Step 1: Note the test coverage** in the ledger: the services and actions are thin I/O wrappers over code already tested (Task 1 computation, Task 2 RLS/`save_play`); their behavior (including "sheet in use") is pinned by the Task 5 E2E, which is written before Task 4's UI is considered done.
- [ ] **Step 2: Implement** the scoring changes and the plays service/actions/index per the interfaces. `index.ts` exports services, types and (after Task 4) components, mirroring `src/features/scoring/index.ts`.
- [ ] **Step 3: Run** `npx vitest run && npm run typecheck && npx eslint src` — Expected: PASS.
- [ ] **Step 4: Commit** `feat(plays): services and actions; sheets in use cannot be deleted`.

---

### Task 4: Match form, game-page panel and routes

**Files:**
- Create: `src/features/plays/components/play-form.tsx`, `src/features/plays/components/plays-panel.tsx`, `src/app/[locale]/(app)/games/[id]/plays/new/page.tsx`, `src/app/[locale]/(app)/games/[id]/plays/[playId]/page.tsx`
- Modify: `src/features/catalog/components/game-detail.tsx` (optional slot `playsPanel?: ReactNode`, rendered right after `scoringPanel`), `src/app/[locale]/(app)/games/[id]/page.tsx`, `src/features/plays/index.ts`, `src/features/scoring/index.ts` (export `ScoreFields` already exists; export `SheetOption`, `listSheetOptions`), `src/i18n/messages/{en,es,fr}.json` (namespace `Plays`: panel, form, players, results, errors incl. every action error and the field codes `required/tooLong/invalidDate/outOfRange`)

**Interfaces:**
- Consumes: `computePlay`, `ParticipantInput` (Task 1); `createPlayAction`, `updatePlayAction`, `deletePlayAction`, `PlaySummary`, `PlayDetail`, `listPlaysForGame`, `getPlay`, `getPlayDefaults` (Task 3); `ScoreFields`, `SheetOption`, `listSheetOptions` (scoring); `getGameDetail` (catalog; expansions come from `game.relations` with `gameId !== null`).
- Produces:
  - `PlaysPanel({ gameId, plays }: { gameId: string; plays: PlaySummary[] }): JSX.Element` — "Matches" section: count, a **"Log a match"** link to `/games/[id]/plays/new`, the 20 latest (date, sheet title or "manual totals", players with totals, winner badge) each linking to `/games/[id]/plays/[playId]`; empty state when none.
  - `PlayForm(props: { gameId: string; gameName: string; sheets: SheetOption[]; defaultSheetId: string | null; expansions: { id: string; name: string }[]; initial?: PlayDetail }): JSX.Element` (client).
- Behavior of `PlayForm`: date (default today), duration (optional), notes, expansion checkboxes (only when the game has local expansions), sheet select (the user's sheets for the game + "No sheet: manual totals"; preselected `defaultSheetId`; **disabled when editing**), players list (name input, remove button, "Add player" up to 12; starts with 2 empty rows; stable client row ids as React keys — never key on the typed name), and per player a card with `ScoreFields` for the chosen sheet or a single manual-total field, plus the live total, rank and a "Winner" badge from `computePlay`. Save is disabled while any name is empty, any field error exists, or nothing changed (edit). Create → `router.replace(/games/[id])`; edit shows "Saved." and offers Delete with the library-style inline confirmation. Server `invalid`/`limit`/`not_found`/`failed` show translated messages in an `aria-live` region. Changing the sheet in create mode clears the entered values.
- Pages: `new` → 404 unless `getGameDetail` finds the game; `[playId]` → 404 unless `getPlay` returns a play whose `gameId` equals the route's game.

- [ ] **Step 1: Add the `Plays` messages** (en, es, fr) and run `npx vitest run src/i18n` — Expected: PASS.
- [ ] **Step 2: Implement** the components, pages and slot wiring.
- [ ] **Step 3: Run** `npx vitest run && npm run typecheck && npx eslint src && npm run build` — Expected: PASS; the build lists the two new routes.
- [ ] **Step 4: Commit** `feat(plays): match form, game-page panel and routes`.

---

### Task 5: E2E, accessibility and docs

**Files:**
- Create: `tests/e2e/app-plays.spec.ts`
- Modify: `tests/e2e/helpers.ts` + `tests/e2e/auth.setup.ts` (user `h`: `bglib-e2e-h+clerk_test@example.com`, `STATE_FILE.h`, add `"h"` to the setup loop), `docs/DATABASE.md` (§7), `docs/SECURITY.md` (`plays` row), `docs/ROADMAP.md` (5b status and counts), `docs/DECISIONS.md` (ADR-032: matches from the game page only, server-authoritative totals, `no action` FK, ties/no-score rules)

**Interfaces:**
- Consumes: everything above. Fixtures: game prefix `9904` (`cleanupCatalogFixtures([userH], "9904")`; matches and sheets cascade); an expansion fixture game linked through `relations` so the expansion checkbox appears; sheets are created through the DB helper `withDb` with a valid 7 Wonders-like definition (not through the editor) to keep this spec independent of the editor's UI.

- [ ] **Step 1: Write the E2E spec** (pattern: `app-scoring-sheets.spec.ts`; serial; user `h`): `the game page shows an empty matches section and a "Log a match" link`; `logging a match with a sheet: two players, the live totals show 30 and 12 and a Winner badge on the first; saving stores server-computed totals, ranks (1, 2), winner flags, the sheet version id and the scores (DB check)`; `a tie gives both players the Winner badge and rank 1`; `a match with no scores records no winner`; `a match without a sheet uses manual totals`; `expansion checkboxes appear and are stored`; `the 13th player cannot be added (button disabled at 12)`; `typing a player name key by key keeps the focus` (use `pressSequentially`, Review Focus 5); `a player name like <img src=x onerror=window.__pwned=1> is shown as text and never executed; a 61-char name is refused; padding spaces are trimmed (DB)`; `editing a match: the sheet select is disabled, changing a score recalculates ranks and winners (DB)`; `deleting a match asks for confirmation and can be cancelled`; `stored totals are the server's: after saving, the DB totals, ranks and winner flags equal what the engine computes from the stored scores (client-sent totals are impossible by schema, see Task 1)`; `deleting a sheet that has matches shows the "in use" message and keeps the sheet`; `a sheet without matches can still be deleted`; `another user (b) cannot open the match (404) and sees no matches on the game page`; `translated es and fr (panel title and form title)`; axe light/dark on the game page, `plays/new` and a match page; `phone width: no sideways scroll, buttons ≥ 44 px`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/app-plays.spec.ts --project=app-desktop` — Expected: FAIL first where behavior is missing, then PASS after fixing Tasks 3–4 code (axe contrast, labels, focus).
- [ ] **Step 3: Update the docs** listed above (Spanish, matching the existing style).
- [ ] **Step 4: Full verification:** `npx prettier --check . && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run e2e` — Expected: all green; previous counts (309 unit, 101 RLS, 142 E2E) plus the new ones.
- [ ] **Step 5: Commit** `feat(plays): Phase 5b E2E and docs`.

---

## Self-review

- **Spec coverage (delivery 2):** entry only from the game page (T4, no nav change); creator-only matches, names free text ≤12, notes, duration, date, expansions (T2/T4); points through a sheet with server-recomputed totals or manual totals (T1/T3); ranks/winners/ties/no-score (T1); edit recalculates with the stored version and the sheet is fixed (T3/T4); delete (T3/T4); per-game history (T4); atomic writes (T2); migration/RLS/caps (T2); docs/ADR (T5). Out by design: `user_id` on participants (Phase 8; adding a nullable column later is trivial), photos (7), statistics (6), 👍/flags after a match (5c).
- **Calls I made beyond the spec:** `save_play` RPC for atomicity; FK `no action` instead of `restrict` (account/game deletion must cascade; deleting a used sheet gets an "in use" message); highest total wins; blank player = unranked, nobody-scored = no winner; no seat reordering (rows are ordered, add/remove only); 20 matches listed per game with no pagination; `played_on` is a date (not a timestamp); last-write-wins on edit (single owner).
- **Consistency:** `ParticipantInput/Result`, `PlayComputation`, `SheetOption`, `PlaySummary/PlayDetail`, `PlayResult` are each defined once (T1, T3) and only referenced afterwards; `SheetDetail.versionId` is added in T3 and consumed by `createPlay`.
