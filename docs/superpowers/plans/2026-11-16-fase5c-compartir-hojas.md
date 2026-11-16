# Phase 5c — Sharing score sheets and community reliability: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can publish a score sheet for a catalog game; everyone can browse community sheets ranked by accuracy, copy them, and score matches with them directly; people who used a sheet vote it up or flag a wrong total; an administrator verifies or disables sheets; account deletion and unpublishing never break other people's matches.

**Architecture:** One migration (0011) extends `scoring_sheets` (publish/verify/disable columns, column-level grants), adds `scoring_votes`, a security-definer ranking function with a Wilson lower bound, admin functions, a profile-deletion trigger, locked caps, and the deferred `plays` column restriction. The scoring module gains publish/vote/admin services and actions; the UI gets a "Community sheets" section, a read-only sheet page with copy/vote/admin controls, and a grouped sheet picker in the match form.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), TypeScript strict, Zod 4, Supabase (RLS, Clerk third-party auth), next-intl (en/es/fr), Tailwind v4 + shadcn (radix-nova), Vitest, Playwright, `pg` RLS tests.

**Spec:** `docs/superpowers/specs/2026-11-16-fase5-partidas-puntuacion-design.md` §7, §9 (delivery 3) and the 2026-11-16 "Decisiones mías para la 5c" paragraph.

## Global Constraints

- Before writing any Next.js code read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md). Next 16: `proxy.ts`; wrap every `catch` around `auth()` with `unstable_rethrow`.
- No hard-coded UI strings: everything in `src/i18n/messages/{en,es,fr}.json` with identical keys (`src/i18n/messages.test.ts`). Validation/engine/server errors are stable **codes** the UI translates. Never import `cn` from `"cn"` (ADR-016). Touch targets ≥ 44 px; every control labelled; axe (wcag2a/aa/21aa/22aa) clean in light and dark.
- Client components never import `@/features/scoring` (its index exports `server-only` code): use `@/features/scoring/client` or `import type`.
- Publishing is per **sheet** (all its versions). Only sheets of **catalog (global) games** can be published. Max **5 publications per user per day**. The author is **never shown** to other users.
- Visibility: other users see a sheet only if it is `public` and not disabled; the owner always sees theirs; a user who has a **match using a sheet's version** keeps read access to that sheet and that version even after it is unpublished or disabled (their match must keep working). Disabled sheets are hidden from rankings, pickers and `getSheet` for others and cannot be chosen for new matches; existing matches keep them.
- Votes: one per user and **version**, `up` or `flag` (flag needs a reason 1–300 chars; up has none), only from a user with their **own match that uses exactly that version**, never on one's own sheet; changeable and deletable. A sheet's score uses the votes of its **latest version** only: Wilson lower bound (z = 1.96) of up / (up + flags); no votes → 0. Ranking order: verified first, then score, then uses (distinct users with a match on the latest version), then oldest first.
- Verified/disabled are set **only** through admin SQL functions (`is_admin()` checked inside); table grants must stop users writing `published_at`, `verified_*`, `disabled_*` directly. Flag reasons are readable only by administrators and by their author.
- The 5b-deferred fix is part of this migration: `plays` is updatable only in `played_on`, `duration_minutes`, `notes` (table-level `update` revoked, column grants given).
- Caps that were count-based (20 private sheets per user and game, 50 versions per sheet, 5 000 matches, 12 players, 20 expansions) must be race-free: lock the parent row (`select … for update`) inside the trigger.
- Account deletion: a `before delete` trigger on `profiles` deletes the user's matches, then their sheets that are private or not used by anyone else's match; public sheets used by others stay with `owner_id = null` (anonymous). No FK error may surface.
- DB: RLS on every table; `security invoker` unless stated; `set search_path = ''`; ids from `public.current_user_id()`. No Docker; RLS tests run against the Supabase dev DB (`tests/integration/db.ts`). **Ask the user before `npx supabase db push`.**
- E2E fixture prefix `9905` (taken: 9900–9904) and new test users `i` (author), `j` (consumer), `k` (administrator for this spec only; the role is granted in `beforeAll` and removed in `afterAll`, like `app-game-center.spec.ts`).
- Commit after each task. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A user cannot, through the API, set `verified_*`, `disabled_*`, `published_at` or `owner_id` on a sheet, publish a custom game's sheet, exceed 5 publications a day, vote on their own sheet, vote without a match on exactly that version, vote twice for a version, or read other people's votes and flag reasons. (Task 1)
2. Unpublishing or disabling a sheet never breaks other people's existing matches: they still open, edit and show the sheet; the sheet disappears only from rankings and from the picker of **new** matches. (Task 1, Task 4, Task 5)
3. Ranking sanity: 2 votes never beat 50; zero votes score 0; all-flag sheets rank low; a verified sheet ranks first even with a worse score; ties are stable; only the latest version's votes count. (Task 1, Task 2)
4. Deleting an account: public sheets used by others survive anonymously with their versions and other people's matches intact; private and unused ones are gone; no FK error; the user's votes disappear with them. (Task 1)
5. Disabled or private sheets of other users, flag reasons, and author identity never leak: not in rankings, pickers, `getSheet`, page HTML or error messages. (Task 1, Task 5)

---

## File Structure

```
supabase/migrations/20261116140000_sheet_sharing.sql
tests/integration/rls-sharing.test.ts
src/features/scoring/
  ranking.ts (+ test)                     pickDefaultSheet()
  services/community-service.ts           publish/unpublish, rankings, votes, admin (server-only)
  actions/community-actions.ts            "use server"
  components/community-sheets.tsx         ranked list with badges, copy, view
  components/sheet-view.tsx               read-only sheet page body (preview, copy, vote info)
  components/publish-toggle.tsx           publish / unpublish control for the owner
  components/sheet-vote.tsx               👍 / flag form for a match
  components/admin-sheet-controls.tsx     verify / disable + flag reasons (admin only)
tests/e2e/app-sheet-sharing.spec.ts
```
Modified: `src/features/scoring/services/sheet-service.ts` (`SheetDetail`/`SheetSummary` gain `visibility`, `verified`, `disabled`; `listSheetOptions` ranked and flagged; `createSheet`/`copySheet` unchanged), `src/features/scoring/index.ts` and `client.ts`, `src/features/scoring/components/sheets-list.tsx` (mine only; publish status), `src/app/[locale]/(app)/games/[id]/sheets/page.tsx` (+ community section), `src/app/[locale]/(app)/games/[id]/sheets/[sheetId]/page.tsx` (read-only view for non-owners), `src/features/plays/components/play-form.tsx` (grouped picker, default, redirect to the match after creating with someone else's sheet), `src/features/plays/services/play-service.ts` (`getPlayDefaults`), `src/app/[locale]/(app)/games/[id]/plays/[playId]/page.tsx` (vote section), `src/features/profiles` only if the trigger makes `deleteUserData` simpler (no change expected), messages, `tests/e2e/helpers.ts` + `auth.setup.ts` (users i, j, k), docs.

---

### Task 1: Migration 0011 and RLS tests

**Files:**
- Create: `supabase/migrations/20261116140000_sheet_sharing.sql`, `tests/integration/rls-sharing.test.ts`
- Modify: `src/lib/supabase/database.types.ts` (`npm run db:types`, then `npx prettier --write` on it), `tests/integration/rls-scoring.test.ts` and `tests/integration/rls-plays.test.ts` only where an existing expectation legitimately changes (public is now allowed; cap errors unchanged)

**Interfaces — produces:**
- `scoring_sheets` gains `published_at timestamptz`, `verified_at timestamptz`, `verified_by text → profiles on delete set null`, `disabled_at timestamptz`, `disabled_by text → profiles on delete set null`; `owner_id` becomes **nullable** and its FK becomes `on delete set null`.
- Table grants: `revoke insert, update on public.scoring_sheets from authenticated; grant insert (id, game_id, owner_id, title, locale, visibility, copied_from), update (title, locale, visibility) on public.scoring_sheets to authenticated;`. `plays`: `revoke update on public.plays from authenticated; grant update (played_on, duration_minutes, notes) on public.plays to authenticated;`.
- Publish trigger (`before insert or update` on `scoring_sheets`): when a row becomes `public` it must belong to a catalog game (`games.owner_id is null`) else `PB001`; the owner must have fewer than 5 sheets with `published_at > now() - interval '1 day'` else `PB002`; it sets `published_at = now()`. A trigger also keeps `visibility` changes from touching `verified_*`/`disabled_*` (columns are not writable anyway).
- Policies: `scoring_sheets` select = `owner_id = me` **or** (`visibility = 'public'` and `disabled_at is null`) **or** `public.i_use_sheet(id)` **or** `public.is_admin()`; insert/update `with check` now allow `visibility in ('private','public')` (the trigger enforces the rules); `scoring_sheet_versions` select stays "its sheet is visible". `public.i_use_sheet(p_sheet uuid) returns boolean` — `security definer`, `set search_path = ''`: true when the caller has a match whose version belongs to that sheet (this avoids a policy recursion between sheets and versions).
- `scoring_votes(id uuid pk, version_id → scoring_sheet_versions on delete cascade, user_id text not null default current_user_id() → profiles on delete cascade, play_id uuid null → plays on delete set null, kind text check in ('up','flag'), reason text null, created_at, updated_at, unique (user_id, version_id), check ((kind = 'up' and reason is null) or (kind = 'flag' and char_length(reason) between 1 and 300)))`. Policies: select own or admin; insert/update `with check`: `user_id = me`, `play_id` is one of the caller's own matches **and** that match's `scoring_version_id = version_id`, and the version's sheet `owner_id is distinct from me`; delete own. `set_updated_at` trigger.
- `public.sheet_rankings(p_game_id uuid) returns table (sheet_id uuid, title text, locale text, version integer, version_id uuid, is_mine boolean, visibility text, verified boolean, disabled boolean, up_votes integer, flag_votes integer, uses integer, score double precision)` — `security definer`, `set search_path = ''`, executable by `authenticated`. Returns the sheets of the game the caller may see (owner = me, or public and not disabled; **disabled sheets only for their owner**), counts over each sheet's **latest version** only, `score` = Wilson lower bound (z = 1.96; 0 when no votes), ordered by `verified desc, score desc, uses desc, created_at asc, sheet_id`. Never returns `owner_id`.
- Admin functions (`security definer`, `set search_path = ''`, raise `42501` unless `public.is_admin()`): `admin_set_sheet_verified(p_sheet uuid, p_verified boolean) returns void` (only a public, enabled sheet can be verified; sets/clears `verified_at/by`; unverified when disabled or unpublished), `admin_set_sheet_disabled(p_sheet uuid, p_disabled boolean) returns void` (sets/clears `disabled_at/by`; disabling also clears verified), `admin_sheet_flags(p_sheet uuid) returns table (version integer, reason text, created_at timestamptz)` (flags on any version of the sheet, newest first).
- Profile deletion trigger `before delete on public.profiles` (`security definer`): delete the user's `plays`, then their `scoring_sheets` that are private or have no match from another user; the rest keep `owner_id = null` via the FK.
- Race-free caps: `enforce_scoring_sheet_cap`, `number_scoring_sheet_version`, `enforce_play_caps` first take a row lock (`select 1 from public.profiles where id = new.owner_id/created_by for update` for sheet and play caps; `select 1 from public.scoring_sheets where id = new.sheet_id for update` for versions; `select 1 from public.plays where id = new.play_id for update` for participants and expansions).

- [ ] **Step 1: Write failing tests** in `rls-sharing.test.ts` (pattern: `rls-plays.test.ts`; users `test_user_a/b/c` plus an admin via `insert into public.user_roles`; fixtures: a global game, a custom game of A, A's sheet + version, B's sheet, matches): `publishing: an owner can publish and unpublish; published_at is set by the trigger and cannot be written directly`; `a custom game's sheet cannot be published (PB001)`; `the 6th publication within a day is refused (PB002), others are unaffected`; `users cannot set verified_*, disabled_* or owner_id on a sheet (42501 permission denied)`; `visibility: another user sees a public enabled sheet and its versions, never a private one`; `a disabled public sheet is hidden from others but visible to its owner and to admins`; `a user keeps read access to a sheet (and its versions) they have a match on after it is unpublished or disabled (Review Focus 2)`; `votes: needs an own match that uses exactly that version; not on one's own sheet; one per version (23505) but changeable; flag needs a reason, up must have none (23514); delete own`; `a user never sees other users' votes; an admin sees all`; `sheet_rankings: orders verified first, then Wilson score, then uses; 8 up / 2 flags scores 0.490 (±0.001); 0 votes scores 0; 2 up beats nothing but loses to 40 up / 5 flags; only the latest version's votes count (Review Focus 3); never returns another user's private or disabled sheets; has no owner column`; `admin functions: forbidden for non-admins (42501); verify only a public enabled sheet; disabling clears verified; admin_sheet_flags returns reasons only to admins`; `deleting a profile: its private and unused sheets and matches are gone, a public sheet used by another user's match survives with owner_id null and its versions (Review Focus 4), its votes are gone, no FK error`; `plays: table-level update is limited to played_on, duration_minutes, notes (changing game_id or scoring_version_id is refused with 42501)`; `caps are race-free: the trigger takes the parent row lock` (assert the function source contains `for update`, via `pg_get_functiondef`). Update the 5a/5b tests that asserted "public is refused" to the new rules (`visibility public` on a catalog game's sheet now succeeds).
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/rls-sharing.test.ts` — Expected: FAIL (columns/functions missing).
- [ ] **Step 3: Write the migration** per the interfaces, in the style of the earlier migrations.
- [ ] **Step 4: Ask the user before applying** (`AskUserQuestion`: "Apply migration 20261116140000_sheet_sharing.sql to the Supabase dev project?"). On yes: `npx supabase migration list`, `npx supabase db push`, `npm run db:types`, `npx prettier --write src/lib/supabase/database.types.ts`.
- [ ] **Step 5: Run** `npm run test:integration` — Expected: all PASS (124 existing, adjusted where noted, plus the new ones).
- [ ] **Step 6: Commit** `feat(db): publish, vote, rank and moderate score sheets`.

---

### Task 2: Default-sheet choice (pure)

**Files:**
- Create: `src/features/scoring/ranking.ts`
- Test: `src/features/scoring/ranking.test.ts`

**Interfaces:**
- Produces: `type RankedSheet = { id: string; isMine: boolean; verified: boolean; score: number; uses: number; updatedAt: string }` and `pickDefaultSheet(sheets: readonly RankedSheet[], lastUsedSheetId: string | null): string | null` — the sheet the user used in their latest match **if it is among `sheets`**; else the first of the community (not mine) sheets in the given order if any is verified or has `score > 0`; else the user's most recently updated own sheet; else the first community sheet; else `null`. `sheets` arrive already ordered by the ranking function.

- [ ] **Step 1: Write failing tests:** `the last used sheet wins when it is still offered`; `a last used sheet that is not offered (disabled, unpublished) is ignored`; `a verified community sheet beats the user's own newer sheet when nothing was used before`; `a community sheet with score 0 and not verified loses to the user's own sheet`; `with no own sheets, the first community sheet is chosen even with score 0`; `empty list → null`; `does not mutate its input`.
- [ ] **Step 2: Run** `npx vitest run src/features/scoring/ranking.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `ranking.ts`.
- [ ] **Step 4: Run** `npx vitest run src/features/scoring && npx eslint src/features/scoring` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(scoring): default sheet choice`.

---

### Task 3: Community services and actions

**Files:**
- Create: `src/features/scoring/services/community-service.ts`, `src/features/scoring/actions/community-actions.ts`
- Modify: `src/features/scoring/services/sheet-service.ts`, `src/features/scoring/index.ts`, `src/features/scoring/client.ts` (export `pickDefaultSheet` and `RankedSheet`), `src/features/plays/services/play-service.ts` (`getPlayDefaults` uses `pickDefaultSheet` over `listSheetOptions`), `src/i18n/messages/{en,es,fr}.json` (error codes `Community.errors.*`: `custom_game`, `daily_limit`, `own_sheet`, `no_match`, `forbidden`, plus the existing set)

**Interfaces:**
- Consumes: migration 0011 objects (Task 1), `pickDefaultSheet` (Task 2).
- Produces (all `server-only`, RLS client):
  - `type CommunitySheet = { sheetId: string; title: string; locale: string; version: number; versionId: string; isMine: boolean; visibility: "private" | "public"; verified: boolean; disabled: boolean; upVotes: number; flagVotes: number; uses: number; score: number }`
  - `listCommunitySheets(gameId: string): Promise<CommunitySheet[]>` (RPC `sheet_rankings`, order preserved)
  - `publishSheet(sheetId: string): Promise<"ok" | "not_found" | "custom_game" | "daily_limit">` (update `visibility = 'public'`; map `PB001`, `PB002`, `42501`); `unpublishSheet(sheetId: string): Promise<"ok" | "not_found">`
  - `type MyVote = { kind: "up" | "flag"; reason: string | null } | null`; `getMyVote(versionId: string): Promise<MyVote>`; `castVote(input: { versionId: string; playId: string; kind: "up" | "flag"; reason: string | null }): Promise<"ok" | "own_sheet" | "no_match" | "invalid">` (upsert on `(user_id, version_id)`; `42501` → `no_match`/`own_sheet` by checking the sheet owner first); `clearVote(versionId: string): Promise<void>`
  - Admin: `setSheetVerified(sheetId: string, verified: boolean): Promise<"ok" | "forbidden" | "not_found">`, `setSheetDisabled(sheetId: string, disabled: boolean): Promise<"ok" | "forbidden" | "not_found">`, `listSheetFlags(sheetId: string): Promise<{ version: number; reason: string; createdAt: string }[]>` (admin only; `forbidden` maps `42501`)
  - `SheetDetail`/`SheetSummary` gain `visibility`, `verified: boolean`, `disabled: boolean`; `SheetOption` gains `isMine`, `verified`, `score`, `uses`; `listSheetOptions(gameId)` now merges `sheet_rankings` (mine + community, disabled excluded unless mine) and keeps its definition revalidation; **options are returned in ranking order**.
  - Actions (`"use server"`, frame as `sheet-actions.ts`): `type CommunityResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: "unauthenticated" | "invalid" | "not_found" | "custom_game" | "daily_limit" | "own_sheet" | "no_match" | "forbidden" | "failed" }`; `publishSheetAction(sheetId)`, `unpublishSheetAction(sheetId)`, `voteAction(input)`, `clearVoteAction(versionId)`, `setVerifiedAction(sheetId, verified)`, `setDisabledAction(sheetId, disabled)`. Zod: `voteSchema = strict { versionId: uuid, playId: uuid, kind: "up" | "flag", reason: trimmed string 1..300 | null }` (a `flag` without a reason or an `up` with one is `invalid`).

- [ ] **Step 1: Failing test** for the Zod `voteSchema` in `src/features/scoring/schemas.test.ts` (`flag needs a reason, up must not have one, reason ≤ 300 trimmed, extra keys rejected`); everything else is thin I/O pinned by Task 1 (RLS) and Task 5 (E2E): note that in the ledger.
- [ ] **Step 2: Implement** the services, actions and schema; adapt `listSheetOptions` and `getPlayDefaults`.
- [ ] **Step 3: Run** `npx vitest run && npm run typecheck && npx eslint src` — Expected: PASS.
- [ ] **Step 4: Commit** `feat(scoring): publish, vote and moderate (services and actions)`.

---

### Task 4: UI — community list, sheet page, vote, picker, admin controls

**Files:**
- Create: `src/features/scoring/components/{community-sheets.tsx,sheet-view.tsx,publish-toggle.tsx,sheet-vote.tsx,admin-sheet-controls.tsx}`
- Modify: `src/features/scoring/components/sheets-list.tsx`, `src/app/[locale]/(app)/games/[id]/sheets/page.tsx`, `src/app/[locale]/(app)/games/[id]/sheets/[sheetId]/page.tsx`, `src/features/plays/components/play-form.tsx`, `src/app/[locale]/(app)/games/[id]/plays/[playId]/page.tsx`, `src/app/[locale]/(app)/games/[id]/plays/new/page.tsx`, `src/features/scoring/index.ts`, `src/i18n/messages/{en,es,fr}.json` (namespace `Community`: section titles, badges *Verified / Public / Private / Disabled*, vote copy, publish copy, admin copy, empty state; plus `Plays.form` keys for the grouped picker)

**Interfaces:**
- Consumes: Task 3 services/actions/types; `pickDefaultSheet`.
- Produces components:
  - `CommunitySheets({ gameId, sheets }: { gameId: string; sheets: CommunitySheet[] })` — the non-mine entries, in order, each with title, language, version, badges (*Verified*, 👍 n, flags n, "used by n"), a **View** link to `/games/[id]/sheets/[sheetId]` and a **Copy** button (`copySheetAction`, then navigate to the copy). No author is shown. Empty state when none.
  - `SheetsList` shows only `isMine` sheets and now takes `CommunitySheet[]` entries so it can show *Public/Private/Disabled* and mount `PublishToggle`.
  - `PublishToggle({ sheetId, visibility, canPublish }: { sheetId: string; visibility: "private" | "public"; canPublish: boolean })` — publish / unpublish with an inline confirmation; `canPublish` is false for custom games (the control is replaced by a short explanation); maps `daily_limit`/`custom_game` errors to translated text.
  - `SheetView({ gameId, sheet, isAdmin }: { gameId: string; sheet: SheetDetail; isAdmin: boolean })` — read-only title, language, version, badges, the category list (label + type), a **Try it** preview (`ScorePreview`), Copy, and `AdminSheetControls` when `isAdmin`.
  - `SheetVote({ versionId, playId, current }: { versionId: string; playId: string; current: MyVote })` — "How accurate was this sheet?": **👍 Accurate** / **Report wrong total** (reason textarea, required), change/clear; states for saved/error.
  - `AdminSheetControls({ sheetId, verified, disabled, flags }: …)` — *Mark verified / Remove verified*, *Disable / Enable*, and the list of flag reasons (version + text), admin only.
- Page behavior: `/games/[id]/sheets` shows **My sheets** and **Community sheets** (from `listCommunitySheets`); `/games/[id]/sheets/[sheetId]` renders the **editor for the owner** and `SheetView` for anyone else who can read the sheet (404 otherwise); the match edit page renders `SheetVote` when the match has a sheet that is not the user's own; creating a match with someone else's sheet redirects to that match's page (so the vote prompt is the next thing they see) instead of the game page. The match form's sheet picker is grouped (*My sheets* / *Community sheets*, with *Verified* in the option text) and preselects `pickDefaultSheet(...)`; a stored match whose sheet was disabled or unpublished still shows its sheet title and definition.

- [ ] **Step 1: Add the `Community` and extra `Plays.form` messages** (en, es, fr) and run `npx vitest run src/i18n` — Expected: PASS.
- [ ] **Step 2: Implement** the components, page changes and form changes.
- [ ] **Step 3: Run** `npx vitest run && npm run typecheck && npx eslint src && npm run build` — Expected: PASS.
- [ ] **Step 4: Commit** `feat(scoring): community sheets UI, votes and admin controls`.

---

### Task 5: E2E, accessibility and docs

**Files:**
- Create: `tests/e2e/app-sheet-sharing.spec.ts`
- Modify: `tests/e2e/helpers.ts` + `tests/e2e/auth.setup.ts` (users `i`, `j`, `k`), `docs/DATABASE.md` (§8 sharing, votes, rankings, deletion), `docs/SECURITY.md` (sheet and vote rows, admin functions, anonymity), `docs/ROADMAP.md` (5c status and counts), `docs/DECISIONS.md` (ADR-033)

**Interfaces:**
- Fixtures: catalog game (`9905`) and a custom game owned by user `i`; sheets created through `withDb` (valid definitions from `SEVEN_WONDERS`); votes from extra fake users inserted through `withDb` (profiles + votes) to build rankings without dozens of Clerk users; admin role for `k` granted in `beforeAll`, removed in `afterAll`.

- [ ] **Step 1: Write the E2E spec** (serial; pattern: `app-plays.spec.ts`): `the owner publishes a sheet and it shows as Public`; `another user sees it under Community sheets with no author name, and can open it read-only (no editor, no edit URL access)`; `a custom game's sheet offers no publish control`; `the 6th publication in a day shows the daily-limit message`; `copying a community sheet creates an independent private sheet`; `the match form offers the community sheet in its own group and preselects the best-ranked one when the user has none; after using one, that one is the default`; `logging a match with a community sheet redirects to the match page and shows the vote prompt`; `a user votes 👍, changes it to a flag with a reason (reason required), and clears it; the author cannot vote on their own sheet`; `ranking: with seeded votes a verified sheet is first, then the better Wilson score, and 2 votes do not beat 50 (Review Focus 3)`; `an administrator verifies a sheet (badge, first place) and disables another (it disappears for others but the author still sees it as Disabled; an existing match of another user still opens and shows the sheet — Review Focus 2); admin sees flag reasons, a regular user does not (Review Focus 5)`; `unpublishing keeps other users' existing matches working`; `deleting a public sheet that others used shows the "in use" message`; `deleting the account's data (deleteUserData path via DB profile delete) leaves a used public sheet anonymous and other matches intact (Review Focus 4)` (done with `withDb`, not through Clerk); `page HTML for another user never contains the author's id or display name and never lists disabled/private sheets`; `translated es and fr (Community headings)`; axe light/dark on the sheets page, a community sheet page and a match page with the vote prompt; phone width: no sideways scroll, controls ≥ 44 px.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/app-sheet-sharing.spec.ts --project=app-desktop` — Expected: FAIL where behavior is missing, then PASS after fixing Tasks 3–4 code.
- [ ] **Step 3: Update the docs** listed above (Spanish, existing style).
- [ ] **Step 4: Full verification:** `npx prettier --check . && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run e2e` — Expected: all green; previous counts (341 unit, 124 RLS, 166 E2E) plus the new ones.
- [ ] **Step 5: Commit** `feat(scoring): Phase 5c E2E and docs`.

---

## Self-review

- **Spec coverage (delivery 3):** publish for everyone with a daily cap (T1/T3/T4); copy any published sheet (existing `copySheet` + community UI, T4); 👍/flag with reason from real users of the exact version (T1/T3/T4); verified badge and disabling by the administrator (T1/T3/T4); Wilson ordering with verified first, latest version only (T1); default sheet rule (T2/T3/T4); moderation view of flag reasons (T1/T4); anonymisation on account deletion (T1); anonymity of authors (global constraint, T5 check). Also folded in from earlier reviews: `plays` column restriction and race-free caps (T1).
- **Calls beyond the spec:** publishing is per sheet; unpublish allowed; users with a match on a sheet keep read access to it; no author shown; no voting on one's own sheet; votes keep existing when the voter deletes the match (`play_id` set null); admin acts from the sheet page (no admin panel, that is Phase 8); the daily cap counts sheets published in the last 24 h.
- **Consistency:** `CommunitySheet`, `RankedSheet`, `MyVote`, `SheetOption` additions and the action result types are defined once (T2/T3) and referenced afterwards; the migration's function signatures are the only source of the column names used in T3.
