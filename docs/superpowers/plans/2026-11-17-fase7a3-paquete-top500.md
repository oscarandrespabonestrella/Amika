# Phase 7a-3 — Recognize against the BGG top 500 (precomputed reference pack): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pointing the live camera at the box of any of the 500 best-ranked BoardGameGeek games, even one not in the user's catalog, answers "Looks like X" with honest confidence and an "Add to catalog and open" button.

**Architecture:** A one-off script turns `boardgame_ranks.csv` into a pack (`pack-manifest.json` + `vectors-<hash8>.bin`, ~1 MB) using the same CLIP as the worker. The device downloads the pack once (part of the opt-in) into IndexedDB as `kind: "pack"` references with ids `bgg:<bggId>`; catalog games win over pack entries of the same BGG id. Pack covers for ORB come from a new guarded endpoint that only serves manifest ids.

**Tech Stack:** Next.js 16, TypeScript strict, Zod 4, Transformers.js (Node, for the script), IndexedDB (`fake-indexeddb` in tests), Vitest, Playwright (fake camera), next-intl (en/es/fr).

**Spec:** `docs/superpowers/specs/2026-11-17-fase7a3-paquete-top500-design.md`. Builds on ADR-037 and the 7a-2 code in `src/features/recognition/`.

## Global Constraints

- Before writing Next.js code read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md); Next 16: `proxy.ts`; every `catch` around `auth()` uses `unstable_rethrow`. Use Context7 for library questions.
- The feature stays **OFF by default and per device**; nothing (model, engines, pack) is requested until the user confirms; the size warning precedes the first byte. No frame leaves the device; no CDN at run time; the pack comes from our own origin.
- The pack's vectors must be produced with the SAME model and image preparation as `embed.worker.ts` (`EMBED_DIM` 512, L2-normalized).
- Honesty rule unchanged: **0 wrong answers shown as "high" or "medium"**; thresholds only in `embedding/thresholds.ts`.
- The catalog wins over the pack for the same BGG id; the `buildReferences` purge never removes pack entries.
- The 500 = `Rank` 1..500 of `boardgame_ranks.csv` (kept OUTSIDE the repo in `C:\Users\andre\Documents\amika-eval\`; photos and `labels.resolved.json` live there too). The CSV only has 64 px thumbnails: full covers come from BGG's API through the existing `createBggSource` (token in `.env.local`).
- Pack covers are only served from `coverUrl` values **in the manifest**, never from the request, through `isAllowedCoverUrl`/`fetchCoverBytes`/`coverJpeg`.
- No hard-coded UI strings: `src/i18n/messages/{en,es,fr}.json` with identical keys. Never import `cn` from `"cn"`.
- E2E fixture prefix `9910` (9900–9909 taken); spec files named `app-*.spec.ts`; CPU-heavy ones in `app-heavy`.
- Commit after each task; messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A game in both catalog and pack appears once (the catalog one); removing it from the catalog brings the pack entry back. (Task 1, Task 4)
2. A catalog or pack listing failure never deletes stored vectors (lesson of 7a-2). (Task 3)
3. A box NOT in the top 500 and not in the catalog ends "not sure", never a confident wrong pack game. (Task 6)
4. The pack endpoint cannot be used as an open proxy: unknown id, id with path tricks (`../`, `%2e`), non-numeric, no session → same 404/401, no URL ever echoed. (Task 2)
5. A truncated/corrupt/stale `vectors-*.bin` or manifest mismatch is rejected (no partial pack stored, feature keeps working with the catalog). (Task 1, Task 3)

## File Structure

```
scripts/build-reference-pack.mts                       one-off generator (reads CSV, BGG, CLIP)
src/features/recognition/pack/
  csv.ts            parseRanksCsv(text, count)                  pure
  format.ts         encodePack / decodePack (binary)            pure
  merge.ts          mergeReferences(catalog, pack)              pure
  manifest.ts       typed accessor of pack-manifest.json        shared server/client
  pack-manifest.json   (generated, committed)
  install.ts        installPack / packStatus (browser)
  *.test.ts
public/reference-pack/vectors-<hash8>.bin               (generated, committed)
src/app/api/covers/pack/[bggId]/route.ts                pack cover endpoint
```

---

### Task 1: Pure core — CSV, pack format, merge

**Files:** Create `pack/csv.ts`, `pack/format.ts`, `pack/merge.ts` + `*.test.ts`. Modify `embedding/rank.ts` (`Reference.kind` gains `"pack"`).

**Interfaces:**
- Produces: `type RankedRow = { bggId: string; name: string; year: number | null; rank: number }`; `parseRanksCsv(text: string, count: number): RankedRow[]` (rows with `Rank` 1..count, sorted by rank, quoted commas handled, bad/unranked rows dropped); `encodePack(vecs: Float32Array[]): Uint8Array` and `decodePack(bytes: Uint8Array, count: number): Float32Array[]` (throws `PackFormatError` on wrong length, NaN/Infinity, or non-unit vectors beyond 1e-3); `mergeReferences(catalog: Reference[], pack: Reference[], catalogBggIds: ReadonlySet<string>): Reference[]` (drops pack entries whose `bgg:<id>` is in `catalogBggIds`).

- [ ] **Step 1: Failing tests.** `parseRanksCsv`: the real header; `Brass: Birmingham` with a quoted comma name; a row with empty Rank and one with Rank 0 dropped; `count` 2 returns ranks 1 and 2 in order; CRLF input; a file with only a header → `[]`. `format`: round-trip keeps values within 1e-7; length not a multiple of `512*4` throws; a NaN throws; `decodePack(bytes, n)` with the wrong `n` throws. `merge`: catalog `bgg 13` hides `pack bgg:13`; others stay; empty catalog returns the pack untouched.
- [ ] **Step 2:** `npx vitest run src/features/recognition/pack` → FAIL.
- [ ] **Step 3: Implement** the three modules; `rank.ts` `Reference["kind"]` becomes `"cover" | "learned" | "pack"`.
- [ ] **Step 4:** unit suite, `npx tsc --noEmit`, lint → PASS.
- [ ] **Step 5: Commit** — `feat(recognition): pack CSV reader, binary format and merge rule`.

### Task 2: Pack cover endpoint

**Files:** Modify `cover-request.ts` (+test); create `src/features/recognition/pack/manifest.ts`, `src/app/api/covers/pack/[bggId]/route.ts`; Test `tests/e2e/app-pack-covers.spec.ts` (user `o`, prefix `9910`).

**Interfaces:**
- Consumes: `isAllowedCoverUrl`, `fetchCoverBytes`, `coverJpeg` (cover-fetch.ts).
- Produces: `type PackManifest = { version: string; model: "clip-vit-base-patch32"; dim: 512; vectors: string; games: { bggId: string; name: string; year: number | null; rank: number; coverUrl: string }[] }`; `getPackManifest(): PackManifest`; `packCoverUrl(bggId: string): string | null`; `handlePackCoverRequest(bggId: string, deps: PackCoverDeps): Promise<CoverResponse>` with `PackCoverDeps = Omit<CoverDeps, "findCoverUrl"> & { packCoverUrl(id: string): string | null }` (same response table as `handleCoverRequest`).

- [ ] **Step 1: Failing tests** (injected deps): no session → 401; `"abc"`, `"../1"`, `"%2e%2e"`, `"12345678901"` (more than 9 digits) → 404 and `packCoverUrl` never called; id not in the manifest → 404 identical (same status, no body); URL not allowed → 404; fetch failed → 502; success → 200 JPEG with the same cache headers as `handleCoverRequest`. E2E: anonymous → 401; `/api/covers/pack/999999999` and a malformed id → 404.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `handlePackCoverRequest` (regex `^\d{1,9}$` before any lookup); `manifest.ts` imports `pack-manifest.json` and builds a `Map` once; the route wires `auth()` (with `unstable_rethrow`) like the existing one. Until Task 4 generates the real manifest, commit a **2-game fixture manifest** so this task is testable; Task 4 overwrites it.
- [ ] **Step 4:** unit, lint, typecheck, the new E2E → PASS.
- [ ] **Step 5: Commit** — `feat(recognition): guarded cover endpoint for pack games`.

### Task 3: Pack install and storage on the device

**Files:** Create `pack/install.ts` (+test); modify `embedding/reference-store.ts` (+test), `embedding/build-references.ts` (+test), `embedding/activation.ts` (+test), `components/live-identify.tsx`/`live/use-activation.ts` (wiring), `src/i18n/messages/{en,es,fr}.json`.

**Interfaces:**
- Consumes: `decodePack`, `getPackManifest` (dynamic `import()` in the browser), `ReferenceStore`.
- Produces on `ReferenceStore`: `putPack(entries: { gameId: string; vec: Vec }[], version: string): Promise<void>` (replaces ALL pack rows atomically in one transaction), `packVersion(): Promise<string | null>`; `all()` now also returns `kind: "pack"` rows. In `install.ts`: `ensurePack(store: ReferenceStore, deps?: { fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<{ installed: boolean; games: number }>` (no-op when `packVersion()` equals the manifest version; otherwise fetches `/reference-pack/<manifest.vectors>`, decodes, `putPack`; any failure leaves the previous pack untouched and returns `installed: false`). `buildReferences({ …, purge })` never removes ids starting with `bgg:`.

- [ ] **Step 1: Failing tests** (fake-indexeddb): `putPack` replaces a previous pack and leaves `cover`/`learned` rows alone; `packVersion` round-trips; `ensurePack` with a stub fetch: installs once, second call makes no request; a truncated body (`decodePack` throws) leaves the old pack and returns `installed: false`; an aborted fetch stores nothing; fetch 404 stores nothing; `buildReferences` with games `[]` and `purge: true` keeps `bgg:` rows; `removeAllData` empties pack rows (the existing `clear()` test extended); copy: the enable message contains the pack size.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Pack rows reuse the `refs` object store (`key = "pack:<bggId>"`, `gameId = "bgg:<bggId>"`, `kind: "pack"`), the version in a `meta` row inside the same store keyed `"__pack_version"` (filtered out of `all()`); no DB version bump. Wire `ensurePack` into the opt-in install step and into session start (cheap no-op when current). Messages: the 85 MB warning gets "+ about 1 MB for the 500-game pack" (es/fr translated).
- [ ] **Step 4:** unit, lint, typecheck → PASS.
- [ ] **Step 5: Commit** — `feat(recognition): download and store the reference pack`.

### Task 4: Generator script and the real pack

**Files:** Create `scripts/build-reference-pack.mts`; generated and committed: `src/features/recognition/pack/pack-manifest.json`, `public/reference-pack/vectors-<hash8>.bin`; add `"recognition:pack"` to `package.json`.

**Interfaces:**
- Consumes: `parseRanksCsv`, `encodePack`, `createBggSource({ token })` (`fetchGame(externalId): Promise<ExternalGame>`, field `coverUrl`), `fetchCoverBytes`, `coverJpeg`, the CLIP loading code already used by `scripts/eval-recognition.mts` (reuse, do not copy: extract the shared embedder into `scripts/lib/clip-node.mts` if the eval script does not already export it).
- Produces: CLI `npm run recognition:pack -- <csv> [--count 500] [--delay 1500] [--cache <dir>]`.

- [ ] **Step 1: Failing test** (`scripts/build-reference-pack.test.ts` or a unit test of the pure `buildManifest(rows, details, hash)`): rows without a cover are reported in `skipped` and absent from the manifest; manifest order equals rank order; `vectors` names `vectors-<hash8>.bin` where `hash8` is the first 8 hex chars of the SHA-256 of the bytes; count in manifest equals vector count.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Sequential `fetchGame` with `--delay` between calls (BGG throttles), resumable through a JSON cache of details and cover JPEGs in `--cache`, embedding with the shared Node CLIP, a final summary (generated, skipped with ids). `--self-test` runs on 3 synthetic rows without network.
- [ ] **Step 4: Run it for real:** `npm run recognition:pack -- C:\Users\andre\Documents\amika-eval\boardgame_ranks.csv --count 500` (needs `BGG_API_TOKEN` in `.env.local` and the model from `copy-model-assets`; expect 15–30 min). Record in the ledger: generated count, skipped list, `vectors` size, elapsed time. Spot check: the first three manifest names are Brass: Birmingham, Ark Nova, Pandemic Legacy: Season 1.
- [ ] **Step 5:** unit suite, lint, typecheck. **Step 6: Commit** — `feat(recognition): top-500 reference pack and its generator`.

### Task 5: Use the pack in the live session and offer "Add to catalog"

**Files:** Modify `services/recognition-service.ts` (+`actions`), `live/frames.ts`, `live/use-live-recognition.ts`, `components/live-identify.tsx`, `src/i18n/messages/{en,es,fr}.json`; tests: `live/frames.test.ts` (create), `services` unit test for the bggId join, E2E in Task 7.

**Interfaces:**
- Consumes: `mergeReferences`, `getPackManifest`, `ensurePack`, `importGameAction(externalId: string)` (returns `{ ok: true; gameId } | { ok: false; error }`).
- Produces: `RecognitionGame` gains `bggId: string | null` (from `game_external_ids` where `source = 'bgg'`, via an embedded select on `games`); `fetchCoverFrame(id)` maps ids starting `bgg:` to `/api/covers/pack/<bggId>`; hook state `answer` gains `pack?: { bggId: string; rank: number }`; hook method `addAndOpen(gameId: string): Promise<{ ok: true; gameId: string } | { ok: false; error: string }>` (imports, calls `confirm(newGameId)`).

- [ ] **Step 1: Failing tests:** `fetchCoverFrame("bgg:224517", fetchStub)` requests `/api/covers/pack/224517` and a uuid still requests `/api/covers/<uuid>`; `listCoverGames` returns `bggId` for a game with a BGG external id and `null` for a custom game (stubbed client); `mergeReferences` wiring: session references = catalog ∪ pack minus catalog BGG ids (test the pure assembly function `assembleReferences(...)` you extract from the hook). UI: a pack answer renders name, "#rank on BGG" and the Add button; a catalog answer renders the old confirm button; when import fails with `unavailable` the button area shows the translated "BoardGameGeek is not available" message and no navigation happens.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** On session start: `ensurePack(store)`, then references = `mergeReferences(catalogRefs, packRefs, catalogBggIds)`; names map also filled from the manifest (`bgg:<id>` → name). `confirm` keeps working only for catalog ids; a pack answer's primary button is **Add to catalog and open** (`addAndOpen` then `router.push(/games/<newId>)`). "Not this one" works for `bgg:` ids unchanged.
- [ ] **Step 4:** unit, lint, typecheck, `npm run build` (assert no pack/manifest strings in first-load JS) → PASS.
- [ ] **Step 5: Commit** — `feat(recognition): recognize and add games from the top-500 pack`.

### Task 6: Calibration with the real pack

**Files:** Modify `scripts/eval-recognition.mts` (flag `--pack`), `embedding/thresholds.ts` only if the data demands it.

**Interfaces:** Consumes `getPackManifest` data and the `.bin`; produces a per-photo report line `file | expected | in top-500? | answer | level`.

- [ ] **Step 1:** add `--pack` (references = dev catalog covers + the pack minus games already in the catalog); a self-test case where a synthetic photo not in any reference must end "not sure".
- [ ] **Step 2: Run** `npm run recognition:eval -- C:\Users\andre\Documents\amika-eval --labels labels.resolved.json --pack`. Record the table in the ledger: recognized / not sure / WRONG, which photos are in the top 500.
- [ ] **Step 3: Gate:** 0 wrong at "high"/"medium", and every photo whose game is not in the top 500 and not in the catalog ends "not sure". If a wrong answer appears, STOP and report with the table; do not tune thresholds to fit silently. If thresholds change, change them only in `thresholds.ts` and re-run both this evaluation and the old 65-cover check from the 7a-2 ledger.
- [ ] **Step 4: Commit** — `feat(recognition): evaluation against the pack, calibration results`.

### Task 7: E2E, docs and final verification

**Files:** Create `tests/e2e/app-pack-recognition.spec.ts` (`app-heavy`, user `o`, prefix `9910`); modify `docs/DECISIONS.md` (ADR-038), `docs/SECURITY.md` (§17: pack endpoint, licence note), `docs/ROADMAP.md`, `README`/env docs if they mention BGG token needs for production.

- [ ] **Step 1: E2E first:** with the real pack and the Y4M fake camera showing the cover of a top-500 game that is NOT in the test catalog: after enabling, the page requests `/reference-pack/vectors-*.bin` exactly once (and only after Enable is confirmed), the answer is "Looks like <name>" with "#<rank>"; the Add button imports (stub `importGameAction` through the existing E2E BGG fixtures, prefix `9910`) and opens the game page; fresh profile: zero pack requests; a feed of an unknown image never locks; privacy: no request carries image bytes; first-load JS has no `pack-manifest`/`reference-pack` strings; axe light/dark on the pack answer; es/fr labels.
- [ ] **Step 2:** write the docs with the real numbers from Tasks 4 and 6 (pack size, generation time, calibration table, skipped games, licence: vectors derived from BGG covers, personal and non-commercial use, attribution).
- [ ] **Step 3: Full verification:** `npm test`, lint, typecheck, `npm run build`, `npm run test:integration`, full E2E. Expected: all PASS (retried flakes listed in the ledger).
- [ ] **Step 4: Ask the user** to try it on the phone, and to set `BGG_API_TOKEN` in Vercel (production needs it for "Add to catalog" and the BGG search).
- [ ] **Step 5: Commit** — `docs: Phase 7a-3`.
