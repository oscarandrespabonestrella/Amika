# Phase 5a — Scoring engine, score sheets and sheet editor: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can build, version, copy and delete private score sheets for a game with a form editor that shows live totals, backed by a pure, safe scoring engine.

**Architecture:** New feature module `src/features/scoring` (engine = pure TS + Zod, no React/Supabase; services/actions/components like `library`). Two new tables (`scoring_sheets`, `scoring_sheet_versions`) with RLS mirroring the `library_items`/`games` ownership pattern. Sheets are private in this step; publishing, votes and verification are step 5c and are NOT built here.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), TypeScript strict, Zod 4, Supabase (RLS, Clerk third-party auth), next-intl (en/es/fr), Tailwind v4 + shadcn (radix-nova), Vitest, Playwright, `pg` RLS tests.

**Spec:** `docs/superpowers/specs/2026-11-16-fase5-partidas-puntuacion-design.md` (this plan covers its delivery 1 only).

## Global Constraints

- Before writing any Next.js code read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md: this Next is not the one you know). Next 16: `proxy.ts` not `middleware.ts`; wrap every `catch` around `auth()` with `unstable_rethrow`.
- No hard-coded UI strings: every visible string lives in `src/i18n/messages/{en,es,fr}.json` with identical keys (`src/i18n/messages.test.ts` enforces parity and no empty values). Validation/engine errors are stable **codes**; the UI translates them.
- Never import `cn` from `"cn"`; use `@/lib/utils` (ADR-016). shadcn `add` must be re-checked for this.
- Engine: closed set of category types, integers only, **no `eval`**, no string execution. Limits (verbatim from spec): max 40 categories; label ≤ 60 chars; tables ≤ 50 rows; values integers within ±1 000 000; `key` stable and unique.
- Definitions are UNTRUSTED when read back: users hold a Supabase JWT and can write rows directly through PostgREST, bypassing our Zod. Every read path must `validateDefinition` before use; the DB adds its own CHECKs.
- Sheets are `private` only in this step: RLS must reject `visibility <> 'private'` on insert/update.
- Versions are immutable once created (editing = new version). Max 20 private sheets per user and game; max 50 versions per sheet (my calls from the spec).
- DB: RLS on every table; `security invoker` functions; `set search_path = ''`; ids from `public.current_user_id()`; no Docker (RLS tests run against the Supabase dev DB via `tests/integration/db.ts`).
- Commit after each task. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A definition tampered with via direct PostgREST (cycle, unknown ref, oversized, wrong shape) → `evaluate` returns an invalid result; never throws or loops. (Task 2, Task 4)
2. Non-integer, `NaN`, huge, string or wrong-shape values for a field → a field error and the total stays a finite integer. (Task 2)
3. `floor_div` with a zero divisor → field error, 0 points, other categories unaffected. (Task 2)
4. Two tabs saving the same sheet at once → exactly one new version wins, the other gets a clear `conflict`, no duplicate version numbers. (Task 3, Task 4)
5. Hostile label text (`<img onerror>`, 10 000 chars, emoji, padding spaces) → trimmed, length-capped, rendered as plain text. (Task 1, Task 7)

---

## File Structure

```
src/features/scoring/
  engine/definition.ts      Zod schema, types, SCORE_LIMITS
  engine/validate.ts        semantic validation (keys, refs, cycles, limits)
  engine/evaluate.ts        evaluate(definition, values) -> Evaluation
  engine/fixtures.ts        test-only sheets: 7 Wonders, Wingspan
  engine/*.test.ts
  schemas.ts                action input schemas (+ test)
  services/sheet-service.ts server-only DB access (RLS client)
  actions/sheet-actions.ts  "use server" actions
  components/               sheets-list.tsx, sheet-editor.tsx, category-editor.tsx,
                            score-fields.tsx (shared with step 5b), score-preview.tsx
  draft.ts                  newCategory(), slugifyKey() (+ test)
  index.ts                  public API
supabase/migrations/20261116100000_scoring_sheets.sql
tests/integration/rls-scoring.test.ts
tests/e2e/app-scoring-sheets.spec.ts
src/app/[locale]/(app)/games/[id]/sheets/{page.tsx,new/page.tsx,[sheetId]/page.tsx}
```

---

### Task 1: Definition schema and semantic validation

**Files:**
- Create: `src/features/scoring/engine/definition.ts`, `src/features/scoring/engine/validate.ts`
- Test: `src/features/scoring/engine/definition.test.ts`, `src/features/scoring/engine/validate.test.ts`

**Interfaces:**
- Produces:
  - `SCORE_LIMITS: { maxCategories: 40; maxLabel: 60; maxTableRows: 50; maxOptions: 20; maxSetInputs: 8; maxRefs: 8; maxValue: 1_000_000; maxDefinitionBytes: 50_000 }`
  - `CATEGORY_TYPES = ["number","count_times","per_n","boolean","choice","table","set_bonus","derived"] as const`; `type CategoryType`
  - `type Category` (discriminated union on `type`), `type Definition = { schemaVersion: 1; categories: Category[] }`, `definitionSchema` (Zod)
  - `type DefinitionIssue = { code: "shape" | "duplicateKey" | "unknownRef" | "cycle" | "duplicateOption" | "duplicateTableValue" | "duplicateInput" | "noScoringCategory" | "tooLarge"; categoryKey?: string; path?: string }`
  - `validateDefinition(input: unknown): { ok: true; definition: Definition } | { ok: false; issues: DefinitionIssue[] }`

Category shapes (all have `key: /^[a-z][a-z0-9_]{0,29}$/`, `label` trimmed 1–60, `scoring: boolean` default true):
`number {min?,max?}` · `count_times {pointsEach:int, max?}` · `per_n {n:int≥1, pointsPer:int, max?}` · `boolean {points:int}` · `choice {options:[{key,label,points}] 1..20}` · `table {rows:[{value:int,points:int}] 1..50}` (exact-value lookup — my call) · `set_bonus {inputs:[{key,label}] 2..8, perSet:int}` · `derived {op:"sum"|"product"|"floor_div"|"min"|"max", refs:string[] 2..8}` (`floor_div` takes exactly 2 refs: first ÷ second; refs read the referenced category's *points*).

- [ ] **Step 1: Write failing tests** in `definition.test.ts`: `accepts a minimal valid sheet`, `trims labels and rejects empty or 61-char labels`, `rejects non-integer, NaN and >1_000_000 numbers`, `rejects 41 categories and 51 table rows`, `rejects unknown type strings`, `rejects extra properties (strict)`, `rejects a hostile 10_000-char label` (Review Focus 5). In `validate.test.ts`: `duplicateKey`, `unknownRef`, `cycle (a→b→a and self reference)`, `floor_div needs exactly 2 refs`, `duplicateOption`, `duplicateTableValue`, `duplicateInput`, `noScoringCategory when every category has scoring:false`, `tooLarge when JSON exceeds 50_000 bytes`, `returns issues with codes, never throws for null/array/string input`.
- [ ] **Step 2: Run** `npx vitest run src/features/scoring/engine` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `definition.ts` and `validate.ts` with the signatures above. Zod `.strict()` on every object; error messages are the codes. Cycle detection by DFS over `derived.refs`; `validateDefinition` never throws (wrap `safeParse`).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(scoring): definition schema and validation`.

---

### Task 2: Evaluation engine with real-game fixtures

**Files:**
- Create: `src/features/scoring/engine/evaluate.ts`, `src/features/scoring/engine/fixtures.ts`
- Test: `src/features/scoring/engine/evaluate.test.ts`

**Interfaces:**
- Consumes: `validateDefinition`, `Definition`, `Category` (Task 1).
- Produces:
  - `type ScoreValue = number | boolean | string | Record<string, number>` (number→number/count/table/per_n; boolean; string = choice option key; record = set_bonus counters)
  - `type FieldErrorCode = "invalid" | "outOfRange" | "notInTable" | "unknownOption" | "divisionByZero" | "dependency"`
  - `type CategoryResult = { key: string; points: number; error?: FieldErrorCode }`
  - `type Evaluation = { ok: boolean; total: number; categories: CategoryResult[]; invalidDefinition?: true }` (categories in definition order)
  - `evaluate(definition: unknown, values: Record<string, ScoreValue | undefined>): Evaluation`
  - `SEVEN_WONDERS`, `WINGSPAN: Definition` in `fixtures.ts` (test-only; not seeded anywhere)

Rules: missing value = 0 points, no error. `total` = sum of `points` of categories with `scoring: true` (errored categories contribute 0 and set `ok:false`). `evaluate` revalidates the definition itself; an invalid one returns `{ ok:false, total:0, categories:[], invalidDefinition:true }`. Evaluation order is topological over `derived` refs. Points of `number` = its value. `set_bonus` = Σ v² + perSet·min(v). `per_n` = ⌊v/n⌋·pointsPer.

- [ ] **Step 1: Write failing tests** (`evaluate.test.ts`), with these exact values:
  - `7 Wonders: 6 military, 10 coins, 10 wonders, 12 civilian, 4 commerce, 6 guilds, science {tablets:3, compass:2, gears:1} totals 62` (coins → 3 pts, science → 21).
  - `7 Wonders: negative military (-3) lowers the total`; `coins: 2 → 0, 3 → 1, 11 → 3`.
  - `Wingspan: birds 31, bonus 8, goals 12, eggs 14, food 5, tucked 7 totals 77`.
  - `derived min/product/sum/max over support categories (scoring:false) counts only the derived result`.
  - `choice: unknown option → unknownOption; no selection → 0`; `table: value not listed → notInTable`; `boolean true/false`.
  - Review Focus 2: `1.5, NaN, Infinity, 1e21, "7", {} where a number is expected → invalid/outOfRange, total stays a finite integer`.
  - Review Focus 3: `floor_div with second ref = 0 → divisionByZero, 0 points, other categories still scored`.
  - Review Focus 1: `a cyclic, unknown-ref or oversized definition returns invalidDefinition without throwing`, and `evaluate(null/undefined/[] ...)` does not throw.
  - `a dependency on an errored category → dependency error on the derived one`.
  - `Harmonies is not asserted here` (no test): its exact categories must be confirmed with the user before any fixture exists.
- [ ] **Step 2: Run** `npx vitest run src/features/scoring/engine/evaluate.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `evaluate.ts` and `fixtures.ts`. One pure function per category type; keep all arithmetic on `Number.isSafeInteger` checks.
- [ ] **Step 4: Run** `npx vitest run src/features/scoring` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(scoring): evaluation engine with 7 Wonders and Wingspan fixtures`.

---

### Task 3: Migration, RLS and RLS tests

**Files:**
- Create: `supabase/migrations/20261116100000_scoring_sheets.sql`, `tests/integration/rls-scoring.test.ts`
- Modify: `src/lib/supabase/database.types.ts` (regenerate with `npm run db:types`)

**Interfaces:**
- Produces tables (all RLS on, `revoke all … from anon`):
  - `scoring_sheets(id uuid pk, game_id uuid → games on delete cascade, owner_id text not null default current_user_id() → profiles on delete cascade, title text 1..80, locale text ^[a-z]{2}(-[A-Z]{2})?$, visibility text in ('private','public') default 'private', copied_from uuid → scoring_sheets on delete set null, created_at, updated_at)`; index `(game_id, owner_id)`; `set_updated_at` trigger.
  - `scoring_sheet_versions(id uuid pk, sheet_id → scoring_sheets on delete cascade, version int ≥ 1, definition jsonb, created_at)`; `unique(sheet_id, version)`; CHECK `jsonb_typeof(definition)='object' and octet_length(definition::text) <= 50000`.
- Triggers: BEFORE INSERT on versions sets `version = coalesce(max(version),0)+1` and raises `P0001` when the sheet already has 50 versions; BEFORE UPDATE on versions always raises (immutable); BEFORE INSERT on sheets raises `P0001` at 20 private sheets for that user and game; BEFORE UPDATE on sheets forbids changing `game_id`/`owner_id`.
- Policies: sheets — select if `owner_id = current_user_id()` or `visibility='public'` (no public rows can exist yet); insert/update only own, `visibility='private'`, and the game must be visible (`exists (select 1 from games g where g.id = game_id)`); delete own. Versions — select if the parent sheet is visible; insert only when the parent sheet is the user's own; no update policy; delete own sheet's versions.

- [ ] **Step 1: Write failing tests** in `rls-scoring.test.ts` (pattern: `rls-library.test.ts`, users `test_user_a/b`, fixtures insert profiles + a global game + B's custom game): `a user only sees their own sheets and versions`, `anonymous has no access (42501)`, `owner_id defaults to the caller and cannot be spoofed`, `cannot create a sheet for a game the user cannot see`, `visibility public is rejected on insert and update (step 5c opens this)`, `versions are numbered 1,2,3 automatically`, `a version cannot be updated`, `a user cannot add a version to someone else's sheet`, `duplicate (sheet_id, version) → 23505` (Review Focus 4: simulate by inserting with an explicit version via the privileged role), `51st version → P0001`, `21st private sheet per user and game → P0001 but another game is unaffected`, `definition must be an object under 50_000 bytes (23514)`, `game_id and owner_id cannot be changed`, `deleting a game / a profile cascades sheets and versions`, `copied_from is set null when the source is deleted`.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/rls-scoring.test.ts` — Expected: FAIL (tables missing).
- [ ] **Step 3: Write the migration** as specified, following the style of `20261115230000_library.sql` and `20261116000000_game_center.sql`.
- [ ] **Step 4: Apply to the dev project** with `npx supabase db push` (linked dev DB; confirm the pending list contains only this migration), then run `npm run db:types`.
- [ ] **Step 5: Run** the integration tests again — Expected: PASS; also `npm run test:integration` full — Expected: previous 82 still pass.
- [ ] **Step 6: Commit** `feat(db): score sheets and versions with RLS`.

---

### Task 4: Sheet schemas, service and actions

**Files:**
- Create: `src/features/scoring/schemas.ts`, `src/features/scoring/services/sheet-service.ts`, `src/features/scoring/actions/sheet-actions.ts`, `src/features/scoring/index.ts`
- Test: `src/features/scoring/schemas.test.ts`

**Interfaces:**
- Consumes: `validateDefinition`, `Definition` (Task 1); tables and trigger error codes (Task 3).
- Produces (schemas): `sheetCreateSchema {gameId: uuid; title: 1..80 trimmed; locale: one of routing.locales; definition: unknown}`, `sheetVersionSchema {sheetId: uuid; definition: unknown}`, `sheetRenameSchema {sheetId; title; locale}`, `sheetIdSchema = z.uuid()` — all `.strict()`.
- Produces (service, `server-only`, RLS client from `createSupabaseServerClient`):
  - `type SheetSummary = { id: string; gameId: string; title: string; locale: string; latestVersion: number; ownedByMe: boolean; copiedFrom: string | null; updatedAt: string }`
  - `type SheetDetail = SheetSummary & { definition: Definition }`
  - `listSheetsForGame(gameId: string): Promise<SheetSummary[]>`
  - `getSheet(sheetId: string): Promise<SheetDetail | null>` — null when missing or when the stored definition fails `validateDefinition` (logged)
  - `createSheet(input: { gameId; title; locale; definition: Definition }): Promise<{ sheetId: string } | "limit" | "not_found">`
  - `saveSheetVersion(sheetId: string, definition: Definition): Promise<{ version: number } | "conflict" | "limit" | "not_found">` (`23505` → `conflict`, `P0001` → `limit`, `42501` → `not_found`)
  - `renameSheet(...)`, `deleteSheet(sheetId): Promise<void>`, `copySheet(sheetId: string): Promise<{ sheetId: string } | "not_found" | "limit">` (new sheet, `copied_from` set, v1 = source's latest definition, title suffixed from `Scoring.copySuffix` by the caller)
- Produces (actions): `type ScoringResult<T = object> = ({ ok: true } & T) | { ok: false; error: "unauthenticated" | "invalid" | "not_found" | "conflict" | "limit" | "failed"; issues?: DefinitionIssue[] }`; `createSheetAction`, `saveSheetVersionAction`, `renameSheetAction`, `deleteSheetAction`, `copySheetAction` — each: `auth()` → Zod parse → `validateDefinition` (invalid → `{ok:false,error:"invalid",issues}`) → service → `revalidatePath("/", "layout")`, with `unstable_rethrow` in the `catch` (pattern: `library-actions.ts`).

- [ ] **Step 1: Write failing tests** `schemas.test.ts`: `accepts a valid create payload`, `trims the title`, `rejects an 81-char title, a bad locale and extra keys`, `rejects non-uuid ids`.
- [ ] **Step 2: Run** `npx vitest run src/features/scoring/schemas.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** schemas, service, actions and `index.ts` (export schemas types, `listSheetsForGame`, `getSheet`, actions, components added in later tasks).
- [ ] **Step 4: Run** `npx vitest run src/features/scoring && npm run typecheck && npm run lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(scoring): sheet service and actions`.

---

### Task 5: Sheets list, copy/delete and entry point from the game page

**Files:**
- Create: `src/features/scoring/components/sheets-list.tsx`, `src/app/[locale]/(app)/games/[id]/sheets/page.tsx`
- Modify: `src/features/catalog/components/game-detail.tsx` (new optional slot prop `scoringPanel?: ReactNode`), `src/app/[locale]/(app)/games/[id]/page.tsx` (render a small "Score sheets (n)" link panel via `@/features/scoring`), `src/i18n/messages/{en,es,fr}.json` (namespace `Scoring`: titles, empty state, buttons, `copySuffix`, delete confirmation, error codes incl. every `DefinitionIssue.code`, `FieldErrorCode` and action error)

**Interfaces:**
- Consumes: `listSheetsForGame`, `copySheetAction`, `deleteSheetAction` (Task 4).
- Produces: route `/games/[id]/sheets` (404 when the game is not visible); `SheetsList` client component `({ gameId, sheets }: { gameId: string; sheets: SheetSummary[] })` with links to `/games/[id]/sheets/new` and `/games/[id]/sheets/[sheetId]`, a Copy button and a Delete button with inline confirmation (same pattern as the library "Remove" confirmation).

- [ ] **Step 1: Add the `Scoring` messages** in en, es, fr and run `npx vitest run src/i18n` — Expected: PASS (parity, no empties).
- [ ] **Step 2: Implement** the list page, `SheetsList` and the game-page link; empty state uses `EmptyState` from `@/components/empty-state`.
- [ ] **Step 3: Run** `npm run typecheck && npm run lint && npm run build` — Expected: PASS.
- [ ] **Step 4: Commit** `feat(scoring): sheets list, copy and delete`.

---

### Task 6: Sheet editor with live preview

**Files:**
- Create: `src/features/scoring/draft.ts`, `src/features/scoring/components/{sheet-editor.tsx,category-editor.tsx,score-fields.tsx,score-preview.tsx}`, `src/app/[locale]/(app)/games/[id]/sheets/new/page.tsx`, `src/app/[locale]/(app)/games/[id]/sheets/[sheetId]/page.tsx`
- Test: `src/features/scoring/draft.test.ts`
- Modify: `src/i18n/messages/{en,es,fr}.json`

**Interfaces:**
- Consumes: `evaluate`, `validateDefinition`, `Definition`, `Category` (Tasks 1–2); `createSheetAction`, `saveSheetVersionAction` (Task 4).
- Produces:
  - `slugifyKey(label: string, existingKeys: readonly string[]): string` — lowercase ascii, `[a-z0-9_]`, starts with a letter, ≤ 30 chars, unique by numeric suffix; falls back to `category` for empty/non-latin labels.
  - `newCategory(type: CategoryType, label: string, existingKeys: readonly string[]): Category` — valid defaults per type (e.g. `count_times.pointsEach = 1`, `per_n.n = 2`, `derived` starts with the first two existing keys or is blocked in the UI until there are two).
  - `ScoreFields(props: { definition: Definition; values: Record<string, ScoreValue | undefined>; errors?: Record<string, FieldErrorCode>; onChange: (key: string, value: ScoreValue | undefined) => void }): JSX.Element` — one labelled control per category (number input, checkbox, select, grouped counters for `set_bonus`); this exact component is reused by the match form in step 5b.
  - `SheetEditor(props: { gameId: string; gameName: string; initial?: { sheetId: string; title: string; locale: string; definition: Definition; version: number } }): JSX.Element` (client).
- Behavior: category list with add (type picker), move up/down buttons (no drag), delete; `key` is generated once and never editable (stable for stats and later photo scoring), label editable; per-type fields in `category-editor.tsx`; side panel `ScorePreview` runs `evaluate` live on sample input and shows per-category points and the total; issues from `validateDefinition` shown next to the right category using translated codes; Save disabled when unchanged or invalid; success shows "Saved as version N"; a `conflict` result shows a message with a reload action; touch targets ≥ 44 px; labels rendered as text only.

- [ ] **Step 1: Write failing tests** `draft.test.ts`: `slugifyKey("Coins ÷ 3") → "coins_3"`, `suffixes duplicates (coins, coins_2)`, `empty and emoji-only labels fall back to "category"`, `truncates to 30 chars`, `result always matches the key pattern`; `newCategory returns a category that passes validateDefinition for every type`.
- [ ] **Step 2: Run** `npx vitest run src/features/scoring/draft.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `draft.ts` then the components and the two pages (create mode when `new`; edit mode loads `getSheet`, 404 when null or not owned).
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npm run lint && npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(scoring): sheet editor with live preview`.

---

### Task 7: E2E, accessibility and docs

**Files:**
- Create: `tests/e2e/app-scoring-sheets.spec.ts`
- Modify: `tests/e2e/helpers.ts` + `tests/e2e/auth.setup.ts` (new test user `g`: `bglib-e2e-g+clerk_test@example.com`, with its `STATE_FILE.g`), `docs/DATABASE.md` (§7–8 replaced by the sheets/versions model and 0007), `docs/SECURITY.md` (`scoring_configs` row → `scoring_sheets`/`scoring_sheet_versions`), `docs/ROADMAP.md` (Phase 5a status table), `docs/DECISIONS.md` (ADR-030 anyone can author sheets; ADR-031 closed category types + `derived`, integers only)

**Interfaces:**
- Consumes: everything above. Fixture games use external-id prefix `9902` and are removed with `cleanupCatalogFixtures([userG], "9902")` (sheets cascade).

- [ ] **Step 1: Write the E2E spec** (pattern: `app-library.spec.ts`, serial, `canRunAppTests` skip), tests: `an empty game shows "no sheets yet"`, `builds a 7 Wonders sheet (number, per_n coins, set_bonus science) and the preview shows 62 for the fixture values`, `saving creates version 1; editing and saving again creates version 2 and keeps v1 (DB check)`, `the save button is disabled when nothing changed`, `a hostile label (<img src=x onerror=…>, 10 000 chars) is trimmed/limited and rendered as text` (Review Focus 5), `two tabs saving the same sheet: one succeeds, the other shows the conflict message` (Review Focus 4), `copying makes an independent sheet with copied_from set`, `deleting asks for confirmation`, `another user (b) cannot open the sheet (404) or see it in the list`, `the editor and list are translated (es, fr)`, axe light/dark with `wcag2a, wcag2aa, wcag21aa, wcag22aa` on list, new and edit pages, and a mobile-width pass for the editor.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/app-scoring-sheets.spec.ts --project=app-desktop` — Expected: first FAIL until the fixes below, then PASS.
- [ ] **Step 3: Fix** whatever the E2E exposes in Tasks 5–6 code (axe contrast, labels, focus).
- [ ] **Step 4: Update the docs** listed above.
- [ ] **Step 5: Full verification:** `npx prettier --check . && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run e2e` — Expected: all green, previous counts (223 unit, 82 RLS, 120 E2E) plus the new ones.
- [ ] **Step 6: Commit** `feat(scoring): Phase 5a sheets (E2E, docs)`.

---

## Self-review

- **Spec coverage (delivery 1):** engine types and limits (T1–T2), 7 Wonders/Wingspan reproduced (T2; Harmonies deliberately not asserted until its categories are confirmed), sheets + versions + immutability + copy + caps (T3–T5), editor with form-only authoring (T6), private-only RLS with step 5c hooks (`visibility`, `copied_from`) (T3), docs/ADRs (T7). Out of this plan by design: matches (5b), publish/votes/verified/Wilson/moderation (5c), photo scoring (Phase 7), the GDPR anonymisation of public sheets (decided in 5c; here owner deletion cascades because every sheet is private).
- **Calls I made beyond the spec:** table = exact-value lookup; `derived` reads referenced *points*; max 50 versions per sheet; keys immutable after creation; editor uses move buttons, not drag; `schemaVersion: 1` in the definition.
- **Consistency:** `Definition`, `Category`, `DefinitionIssue`, `ScoreValue`, `FieldErrorCode`, `SheetSummary`/`SheetDetail` are defined once (T1, T2, T4) and only referenced afterwards.
