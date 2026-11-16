# Phase 6a — Player roster: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A match's players are entries of the user's own roster instead of loose text: picking a name autocompletes from the roster (or creates a new player), a player can be renamed, merged into another, deleted when unused, and marked as "me", and a player never appears twice in a match.

**Architecture:** One migration (0014) adds `players`, makes `play_participants.player_id` mandatory (migrating existing names), replaces `display_name`, rewrites `save_play` and adds `merge_players`. A new `src/features/players` module (schemas, service, actions, "My players" page) and a combobox `PlayerPicker` in the match form. Stats (6b) will group by `player_id`; nothing here draws charts.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), TypeScript strict, Zod 4, Supabase (RLS, Clerk third-party auth), next-intl (en/es/fr), Tailwind v4 + shadcn (radix-nova) + `cmdk` for the combobox, Vitest, Playwright, `pg` RLS tests.

**Spec:** `docs/superpowers/specs/2026-11-16-fase6-jugadores-estadisticas-design.md` §1–3, §5–7 (6a only).

## Global Constraints

- Before writing any Next.js code read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md). Next 16: `proxy.ts`; wrap every `catch` around `auth()` with `unstable_rethrow`.
- No hard-coded UI strings: everything in `src/i18n/messages/{en,es,fr}.json` with identical keys (`src/i18n/messages.test.ts`). Errors are stable **codes** the UI translates. Never import `cn` from `"cn"` (ADR-016): **re-check every file `shadcn add` writes** (it reintroduces that import). Touch targets ≥ 44 px; every control labelled; axe (wcag2a/aa/21aa/22aa) clean in light and dark.
- Client components never import `@/features/scoring` or `@/features/players` index files that export `server-only` code: use `import type`, or a `client.ts` barrel.
- Roster rules (from the spec): players belong to their creator (RLS owner-only); name 1–60 chars, unique per owner by **normalized** name (lower-case, accent-free, spaces collapsed: `public.normalize_player_name`); max **200 players per user**; `linked_user_id` may only be `null` or the owner's own id (= **"me"**, at most one per owner); a player appears **at most once per match** (`unique (play_id, player_id)`); a player with matches cannot be deleted; merging is refused when the two played together in some match.
- Existing matches keep working: the migration creates one player per (creator, normalized name) from the existing `display_name`s, disambiguating a second equal name inside one match as `Name (2)`, then drops `display_name`. **Before applying, run the read-only dry-run** in Task 2 Step 3 and show its output to the user.
- The database is the authority for name normalization; the TypeScript `normalizePlayerName` only imitates it for the picker. A player typed as new that normalizes to an existing one is **reused**, never duplicated.
- Account/game deletion must stay clean: the existing `cleanup_user_content` trigger deletes the user's matches first, so `players` can cascade afterwards without tripping the `no action` FK.
- DB: RLS on every table; `security invoker` unless stated; `set search_path = ''`; ids from `public.current_user_id()`; column-level grants like `scoring_sheets`. No Docker. **Ask the user before `npx supabase db push`.**
- E2E fixture prefix `9906` (taken: 9900–9905) and test user `l`. The existing 5b/5c E2E specs and RLS tests that create participants must be updated to the roster model in the same task that breaks them.
- Commit after each task. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. The data migration loses nothing: every participant ends with a `player_id`, participant counts before/after are equal, names are unique per owner after normalization, two equal names in one match become `Name` and `Name (2)`. (Task 2)
2. Roster isolation: another user's players are never visible, selectable or attachable to a match; `linked_user_id` can only be self/null; at most one "me"; a user cannot write `owner_id` of a player. (Task 2)
3. Identity rules hold end to end: "Ana", "ana " and "Aná" are one player; one player twice in a match is impossible (UI, schema and DB); rename collision, merge of players who played together, delete-in-use and "me" taken all give a clear translated message, never a 500. (Tasks 1–5)
4. Cascades stay clean: deleting an account, a game or a match leaves no orphan and no FK error; merge and delete are atomic. (Task 2)
5. The picker is robust and accessible: keyboard-only flow, 60 characters exactly (61 refused), emoji, markup shown as text, 12 players, typing never loses focus, works on a phone. (Task 4, Task 5)

---

## File Structure

```
supabase/migrations/20261116170000_players.sql
tests/integration/rls-players.test.ts
src/features/players/
  normalize.ts (+ test)       normalizePlayerName()
  schemas.ts (+ test)         playerNameSchema, renameSchema, mergeSchema, ...
  services/player-service.ts  server-only
  actions/player-actions.ts   "use server"
  components/player-picker.tsx, players-manager.tsx
  client.ts                   client-safe barrel (normalize + picker types)
  index.ts
src/components/ui/{command.tsx,popover.tsx}      via `npx shadcn add command popover` (checked for ADR-016)
src/app/[locale]/(app)/players/page.tsx
tests/e2e/app-players.spec.ts
```
Modified: `src/features/plays/{schemas.ts(+test),services/play-service.ts,components/play-form.tsx,index.ts}`, `src/app/[locale]/(app)/games/[id]/plays/new/page.tsx` and `[playId]/page.tsx` (pass the roster), `src/app/[locale]/(app)/settings/page.tsx` (link), messages, `tests/integration/rls-plays.test.ts`, `tests/integration/rls-sharing.test.ts` (if it inserts participants), `tests/e2e/app-plays.spec.ts`, `tests/e2e/app-sheet-sharing.spec.ts` (helpers that type player names), `tests/e2e/helpers.ts` + `auth.setup.ts` (user `l`), docs.

---

### Task 1: Pure name normalization and schemas

**Files:**
- Create: `src/features/players/normalize.ts`, `src/features/players/schemas.ts`
- Modify: `src/features/plays/schemas.ts`
- Test: `src/features/players/normalize.test.ts`, `src/features/players/schemas.test.ts`, `src/features/plays/schemas.test.ts`

**Interfaces:**
- Produces:
  - `normalizePlayerName(name: string): string` — NFD, strip combining marks, lower-case, collapse any whitespace run to one space, trim. (Imitates `public.normalize_player_name`; the DB wins on any difference.)
  - `PLAYER_NAME_MAX = 60`; `playerNameSchema` (trimmed 1..60; codes `required`, `tooLong`); `renamePlayerSchema = strict { playerId: uuid, name }`; `mergePlayersSchema = strict { keepId: uuid, removeId: uuid }` refusing equal ids (`same`); `playerIdSchema = z.uuid()`; `setMeSchema = strict { playerId: uuid | null }`.
  - In `plays/schemas.ts`: each participant gains `playerId: uuid | null` (default null; **name stays required**); `createPlaySchema`/`updatePlaySchema` gain a refinement `duplicatePlayer` — no two participants may share a `playerId`, nor normalize to the same name (`normalizePlayerName`).

- [ ] **Step 1: Write failing tests.** `normalize.test.ts`: `"Ana", "ana ", " ANA", "Aná", "ana\t" all normalize to "ana"`; `"Ana  María" → "ana maria"`; `emoji and non-latin are kept ("🐦 Ana", "鳥")`; `empty and whitespace → ""`; `idempotent`. `schemas.test.ts`: names 60 ok / 61 and empty rejected, trimming, `mergePlayersSchema` rejects equal ids, `setMeSchema` accepts null. `plays/schemas.test.ts`: `playerId is optional and must be a uuid`; `two participants with the same playerId are rejected (duplicatePlayer)`; `"Ana" and "ana " are rejected as the same player`; `different players with similar names ("Ana", "Anna") are accepted`; the previous test "accepts duplicate names" becomes `rejects duplicate names`.
- [ ] **Step 2: Run** `npx vitest run src/features/players src/features/plays` — Expected: FAIL.
- [ ] **Step 3: Implement** the pure code and the schema changes.
- [ ] **Step 4: Run** the same command plus `npx eslint src/features` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(players): name normalization and schemas`.

---

### Task 2: Migration, data move and RLS tests

**Files:**
- Create: `supabase/migrations/20261116170000_players.sql`, `tests/integration/rls-players.test.ts`
- Modify: `src/lib/supabase/database.types.ts` (`npm run db:types` then `npx prettier --write` on it), `tests/integration/rls-plays.test.ts` (fixtures and expectations that use `display_name`), `tests/integration/rls-sharing.test.ts` if it inserts participants

**Interfaces — produces:**
- `public.normalize_player_name(p text) returns text` — `immutable`, `set search_path = ''`: `lower(public.f_unaccent(btrim(regexp_replace(p, '\s+', ' ', 'g'))))`.
- `players(id uuid pk, owner_id text not null default current_user_id() → profiles on delete cascade, name text check 1..60, linked_user_id text null → profiles on delete set null, created_at, updated_at)`; `set_updated_at` trigger; unique index `(owner_id, public.normalize_player_name(name))`; partial unique `(owner_id, linked_user_id) where linked_user_id is not null`; CHECK `linked_user_id is null or linked_user_id = owner_id`; cap trigger (200 per owner, `P0001`, locks the owner's profile row `for update`). RLS owner-only on select/insert/update/delete; `revoke insert, update … from authenticated; grant insert (id, owner_id, name, linked_user_id), update (name, linked_user_id)`; `revoke all … from anon`.
- `play_participants`: new `player_id uuid not null → players (id)` (no action), `unique (play_id, player_id)`, index on `player_id`; `display_name` **dropped**. The policy `play_participants_all_own` gains `and exists (select 1 from public.players pl where pl.id = player_id)` in `with check` (RLS on players makes that "your own roster").
- Data step (inside the migration, before the NOT NULL): for each participant compute `n = normalize_player_name(display_name)`; within a play, the 2nd, 3rd… participant with the same `n` gets the name `display_name || ' (' || k || ')'` (k = occurrence number) and its normalized name is recomputed; create one player per `(created_by, normalized name)` using the earliest occurrence's spelling; set `player_id`.
- `public.save_play(p jsonb)` replaced: each participant is `{ seat, playerId?, name, total, rank, isWinner, scores }`; with `playerId` it is used as is (must be visible → else RLS `42501`); without it the player is created or reused: `insert into public.players (name) values (name) on conflict (owner_id, (public.normalize_player_name(name))) do update set updated_at = now() returning id`. Everything else (create/replace, `P0002`, caps) as before.
- `public.merge_players(p_keep uuid, p_remove uuid) returns void` — `security invoker`, `set search_path = ''`, `authenticated` only: both must be visible (`P0002`); refuses with `PL001` when some play has both; moves `play_participants.player_id` from remove to keep; if remove is linked and keep is not, keep takes the link (after deleting remove, to respect the partial unique); deletes remove. One transaction.
- Delete of a player with matches fails with `23503` (FK); rename to an existing normalized name fails `23505`; marking a second "me" fails `23505`.

- [ ] **Step 1: Write failing tests** in `rls-players.test.ts` (pattern: `rls-plays.test.ts`; users A/B; fixtures create profiles, a game, players, matches through privileged inserts): `normalize_player_name: Ana/ana /Aná/"Ana  María" give the same results as the TypeScript function for a shared list of inputs` (import `normalizePlayerName`); `a user only sees their own players`; `anonymous has no access`; `owner_id defaults to the caller and cannot be spoofed or changed (42501)`; `name is unique per owner after normalization (23505), but another owner may use it`; `name 1..60 (23514)`; `linked_user_id can only be null or the owner (23514), and only one "me" (23505)`; `the 201st player is refused (P0001)`; `a participant cannot point at another user's player (42501)`; `one player twice in a match (23505)`; `save_play with playerId uses it; with a new name creates it; with "ana " reuses "Ana" (Review Focus 3)`; `save_play with another user's playerId is refused`; `merge_players moves matches and deletes the removed player; refuses when they played together (PL001); transfers "me"; atomic on failure`; `deleting a player with matches fails (23503), without matches works`; `renaming to an existing name fails (23505)`; `deleting a profile, a game or a match leaves no orphan players/participants and no FK error (Review Focus 4)`; `participants without a player do not exist (not null)`. Update `rls-plays.test.ts` fixtures (`display_name` → players + `player_id`) and its expectations (`save_play` payloads; the old "seat/name checks" now check `player_id`/names on `players`).
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/rls-players.test.ts` — Expected: FAIL.
- [ ] **Step 3: Dry-run on the dev database, read-only, and show the output to the user** (via `pg`/`supabase`): number of participants, number of distinct (creator, normalized name) pairs, and the plays that contain two equal normalized names (these will become `Name (2)`).
- [ ] **Step 4: Write the migration** per the interfaces. After a first failed attempt nothing is applied (transaction), so fix and retry; once applied, further fixes need a new migration.
- [ ] **Step 5: Ask the user before applying** (`AskUserQuestion`, quoting the dry-run numbers and that `display_name` is dropped). On yes: `npx supabase migration list`, `npx supabase db push`, `npm run db:types`, `npx prettier --write src/lib/supabase/database.types.ts`.
- [ ] **Step 6: Run** `npm run test:integration` — Expected: all PASS (existing 153, adjusted where noted, plus the new ones).
- [ ] **Step 7: Commit** `feat(db): player roster, participants reference players`.

---

### Task 3: Services and actions

**Files:**
- Create: `src/features/players/services/player-service.ts`, `src/features/players/actions/player-actions.ts`, `src/features/players/index.ts`, `src/features/players/client.ts`
- Modify: `src/features/plays/services/play-service.ts`, `src/features/plays/index.ts`, `src/i18n/messages/{en,es,fr}.json` (error codes `Players.errors.*`: `unauthenticated, invalid, not_found, exists, together, in_use, me_taken, limit, failed`)

**Interfaces:**
- Produces (players service, `server-only`, RLS client):
  - `type Player = { id: string; name: string; isMe: boolean; matchCount: number }`
  - `listPlayers(): Promise<Player[]>` — the roster ordered by `matchCount desc, name`; `isMe = linked_user_id is not null`; `matchCount` from the participants count.
  - `renamePlayer(id: string, name: string): Promise<"ok" | "exists" | "not_found">` (`23505` → `exists`)
  - `mergePlayers(keepId: string, removeId: string): Promise<"ok" | "together" | "not_found">` (RPC `merge_players`; `PL001` → `together`, `P0002`/`42501` → `not_found`)
  - `deletePlayer(id: string): Promise<"ok" | "in_use" | "not_found">` (`23503` → `in_use`)
  - `setMe(playerId: string | null): Promise<"ok" | "me_taken" | "not_found">` — sets `linked_user_id` to the caller's id for that player (clearing it on the previous "me"), or clears it when `null`.
  - `createPlayerIfNeeded(name)` is **not** a service: new names are created by `save_play`.
- Produces (actions, frame as `play-actions.ts`): `PlayerResult<T extends object = object>` with the error union above; `renamePlayerAction`, `mergePlayersAction`, `deletePlayerAction(playerId)`, `setMeAction(playerId | null)`; each: `auth()` → Zod → service → `revalidatePath("/", "layout")`; `unstable_rethrow` in `catch`.
- Plays service changes: `PlaySummary.participants[].name` and `PlayDetail` come from `players(name)` (embed); `PlayDetail.entries[]` gains `playerId: string`; `createPlay`/`updatePlay` put `playerId` (or null) and `name` into each `save_play` participant; `PlayOutcome` mapping unchanged. `getPlay` for a match whose player was merged shows the surviving player.

- [ ] **Step 1: Note the test coverage** in the ledger: the schemas are covered in Task 1, the database behavior in Task 2, and the thin I/O wrappers are pinned by the Task 5 E2E.
- [ ] **Step 2: Implement** the services, actions, barrels and the play-service changes.
- [ ] **Step 3: Run** `npx vitest run && npm run typecheck && npx eslint src` — Expected: PASS.
- [ ] **Step 4: Commit** `feat(players): services and actions; plays read names from the roster`.

---

### Task 4: Picker, match form, My players page

**Files:**
- Create: `src/features/players/components/player-picker.tsx`, `src/features/players/components/players-manager.tsx`, `src/app/[locale]/(app)/players/page.tsx`, `src/components/ui/command.tsx`, `src/components/ui/popover.tsx` (generated)
- Modify: `src/features/plays/components/play-form.tsx`, `src/app/[locale]/(app)/games/[id]/plays/new/page.tsx`, `src/app/[locale]/(app)/games/[id]/plays/[playId]/page.tsx`, `src/app/[locale]/(app)/settings/page.tsx` (link "My players"), `src/features/plays/index.ts`, `src/i18n/messages/{en,es,fr}.json` (namespace `Players`: page, picker, manager, errors; extra `Plays.form` keys)

**Interfaces:**
- Add the dependency with `npx shadcn add command popover` (installs `cmdk`); **fix any `import { cn } from "cn"`** to `@/lib/utils`; run lint.
- Produces:
  - `PlayerPicker(props: { id: string; label: string; value: { playerId: string | null; name: string }; roster: Player[]; takenIds: ReadonlySet<string>; takenNames: ReadonlySet<string>; onChange: (value: { playerId: string | null; name: string }) => void }): JSX.Element` (client). A button with `role="combobox"` labelled by `label` + its value; opens a popover with a search input, the roster (players in `takenIds` omitted or disabled), and, when the typed text is non-empty and matches no roster name by `normalizePlayerName`, a **Create "text"** item; selecting a roster player sets `{ playerId, name }`; creating sets `{ playerId: null, name }`; typed text over 60 chars is refused (`maxLength`). Keyboard: Enter selects the highlighted item, Escape closes, focus returns to the trigger.
  - `PlayersManager({ players }: { players: Player[] })` (client): list with match counts, **Rename** (inline input, `exists` message), **Merge into…** (select of the other players, confirmation, `together` message), **Delete** (disabled with explanation when `matchCount > 0`; inline confirmation otherwise), **This is me / Not me** (`me_taken` handled by moving the mark). Empty state explaining that players are created when you log a match.
- `PlayForm` takes a new prop `roster: Player[]` (the page passes `listPlayers()`); each row now holds `{ playerId, name }` and renders a `PlayerPicker` instead of the text input; the picker's `takenIds/takenNames` come from the other rows; the row's remove button and the 12-player rule stay; the payload sends `playerId` and `name`. Editing a saved match preselects its stored players. Roster players you create appear in the roster next time without a manual refresh (the action revalidates).
- Page `/players` (server): `getTranslations`, `listPlayers()`, heading + `PlayersManager`; linked from Settings and from the match form ("Manage players").

- [ ] **Step 1: Add the `Players` messages** (en, es, fr) and run `npx vitest run src/i18n` — Expected: PASS.
- [ ] **Step 2: Install shadcn `command` and `popover`**, fix the `cn` imports, run `npx eslint src/components`.
- [ ] **Step 3: Implement** the components and page changes.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npx eslint src && npm run build` — Expected: PASS; the build lists `/[locale]/players`.
- [ ] **Step 5: Commit** `feat(players): player picker, My players page, roster-based match form`.

---

### Task 5: E2E, adjust earlier specs, docs

**Files:**
- Create: `tests/e2e/app-players.spec.ts`
- Modify: `tests/e2e/app-plays.spec.ts`, `tests/e2e/app-sheet-sharing.spec.ts` (every place that types a player name or inserts participants with `display_name`), `tests/e2e/helpers.ts` + `auth.setup.ts` (user `l`), `docs/DATABASE.md` (§7), `docs/SECURITY.md`, `docs/ROADMAP.md` (6a status and counts), `docs/DECISIONS.md` (ADR-034)

**Interfaces:**
- Consumes: everything above. New E2E helper (shared by the three specs, in `helpers.ts`): `pickPlayer(page, n, name)` — opens the combobox labelled "Name of player {n}", types the name, presses Enter (selects the existing player or creates it).
- Fixtures: catalog game `9906`; a sheet through `withDb`; players created through the UI or `withDb`.

- [ ] **Step 1: Write the E2E spec** (serial; user `l`; pattern `app-plays.spec.ts`): `the first match creates players from typed names and they show on My players with their match counts`; `typing "ana " or "Aná" in a later match reuses the existing Ana (no duplicate in the roster)`; `the same player cannot be chosen twice in one match`; `the 13th player is refused`; `typing a name key by key keeps focus and 61 characters are refused; emoji and markup are shown as text`; `keyboard only: open, type, Enter, next row`; `rename updates every match; renaming to an existing name shows the message`; `merge moves matches and removes the other player; two players who played together cannot be merged (clear message)`; `a player with matches cannot be deleted; an unused one can`; `"This is me" can be set, moved to another player and cleared`; `editing a saved match shows its stored players; a merged player shows as the survivor`; `another user cannot see or use my players`; `translated es/fr (page title and picker)`; axe light/dark on My players, the match form with the picker open, and a saved match; phone width: no sideways scroll and controls ≥ 44 px. Update the 5b/5c specs' name typing to `pickPlayer` (their other assertions stay) and their direct DB inserts to the roster model.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/app-players.spec.ts tests/e2e/app-plays.spec.ts tests/e2e/app-sheet-sharing.spec.ts --project=app-desktop` — Expected: FAIL where behavior is missing, then PASS after fixing Tasks 3–4 code.
- [ ] **Step 3: Update the docs** (Spanish, existing style): DATABASE §7 (roster, `player_id`, `save_play`, `merge_players`, rules), SECURITY (players row, "me" rule), ROADMAP (6a table and counts), DECISIONS ADR-034 (identity model, option 2 rationale, normalization by the DB, link to accounts deferred to Phase 8).
- [ ] **Step 4: Full verification:** `npx prettier --check . && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run e2e` — Expected: all green; previous counts (353 unit, 153 RLS, 191 E2E) plus the new ones.
- [ ] **Step 5: Commit** `feat(players): Phase 6a E2E and docs`.

---

## Self-review

- **Spec coverage (6a):** roster entity with normalized uniqueness, cap and "me" (T2); participants reference players, no duplicates in a match, migration of existing names (T2); `save_play` creates/reuses players atomically (T2/T3); rename, merge, delete-if-unused and "me" (T2/T3/T4); picker with creation and duplicate prevention (T1/T4); My players page linked from Settings and the form (T4). Out of scope as agreed: invitations/links to other accounts and shared stats (Phase 8), statistics and charts (6b).
- **Calls beyond the spec:** no automatic "me" player (it is marked by the user); a player cannot appear twice in a match (this also removes the old "duplicate names allowed" behavior); the DB decides normalization; merge refuses players who played together instead of guessing; rename to an existing name is refused (merge instead); the picker is a `cmdk` combobox from shadcn.
- **Consistency:** `Player`, `normalizePlayerName`, the roster-based participant payload (`playerId` + `name`) and the error codes are defined once (T1/T3) and only referenced afterwards; the migration is the only source of the column and function names used in T3.
