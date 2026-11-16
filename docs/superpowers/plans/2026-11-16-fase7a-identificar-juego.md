# Phase 7a — Identify a game from a photo, on the device: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user photographs a game box (or scans its barcode) and gets a ranked list of matching games from our catalog (and BGG by text), confirms one by hand, and the photo never leaves the device.

**Architecture:** A new `src/features/recognition/` module. Pure TypeScript logic (barcode check digits, dHash + Hamming, OCR line cleaning, text similarity, candidate merging, the `GameRecognizer` extension point) is shared by browser and server. Browser-only engines (barcode, OCR, image prep) are lazy-loaded and self-hosted. One server action turns the three signals (barcode, title lines, image hash) into ranked candidates using the existing `search_games`, the existing BGG source and two new tables (`game_barcodes`, `game_image_hashes`). Cover hashes are computed server-side at import time from the linked cover image and the image is discarded.

**Tech Stack:** Next.js 16, TypeScript strict, Zod 4, Supabase (RLS, SQL functions), next-intl (en/es/fr), `tesseract.js` (+ self-hosted core/language data), `BarcodeDetector` with `zxing-wasm` fallback, `sharp` on the server (verify it is already present as Next's image dependency), Vitest, Playwright (+ axe).

**Spec:** `docs/superpowers/specs/2026-11-16-fase7a-identificar-juego-design.md`.

## Global Constraints

- Before writing any Next.js code read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md). Next 16: `proxy.ts`; wrap every `catch` around `auth()` with `unstable_rethrow`. Use Context7 for `tesseract.js`, `zxing-wasm`, `sharp` and Clerk-CSP questions.
- **The photo never leaves the device.** No request during identification may carry image bytes; only OCR text lines (≤ 3, ≤ 80 chars each), a barcode string and a 16-hex-char image hash go to the server. The UI says so.
- Only the current stack: no Rust or other languages/frameworks. Open-source libraries, local processing. **No external AI is implemented.** The `GameRecognizer` interface may declare `requiresConsent`, but nothing registers a consenting recognizer, and the registry refuses to run one without an explicit consent argument.
- Heavy code (`tesseract.js`, `zxing-wasm`) is dynamically imported only when the user starts an identification; it must not appear in the initial JS of any route. OCR core and language data are **self-hosted** (copied from npm packages to a git-ignored `public/tesseract/` by a script, never fetched from a CDN at runtime). Languages: the UI locale + English.
- Cover images are **never stored**: the server fetches the linked cover transiently (https only, host allowlist, ≤ 2 MB, 5 s timeout, no redirects off the allowlist), computes the hash, discards the image. A failure here never fails an import.
- Hash format: a 64-bit dHash written as **16 lowercase hex characters** in TypeScript and RPC arguments (never a JSON number: precision), stored as `bigint`. The browser (canvas) and server (`sharp`) pipelines must agree within Hamming distance ≤ 6 on the same image (tested).
- BGG search is rate limited per user (10/min, 60/h) and each call counts: one identification may make **at most 2** BGG searches, and only when no local candidate is strong. When rate limited, return local candidates plus a `bggLimited` flag; never an error.
- No hard-coded UI strings: `src/i18n/messages/{en,es,fr}.json` with identical keys (`messages.test.ts`). Hostile text (markup, emoji, very long lines) is displayed as text.
- DB: RLS on every table; `security invoker` unless stated; `set search_path = ''`; ids from `public.current_user_id()`; column-level grants; caps race-free (lock the parent row). No Docker. **Ask the user before `npx supabase db push`.**
- Never import `cn` from `"cn"` (ADR-016); `npx shadcn add` is not expected here.
- Client components never import server-only code; the module has a `client.ts` barrel.
- E2E fixture prefix `9908` (taken: 9900–9907) and test user `n` (add to `TEST_USERS`/`STATE_FILE` in `tests/e2e/helpers.ts` and to `auth.setup.ts`).
- Commit after each task. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. The photo never leaves the device: an E2E intercepts every request during an identification and asserts none carries image data and the only app endpoint called is the candidates action with the small payload described above. (Task 6, Task 7)
2. Isolation: one user's learned barcodes and photo hashes are invisible to others; cover hashes are readable only for games the viewer can see and writable only by the server; caps hold under concurrency. (Task 3)
3. Wrong answers are never presented as certain: garbage OCR (non-Latin script, emoji, 1-character noise, 500-character lines, markup), a barcode that matches nothing, a hash with no near neighbour and an empty result all produce an honest "no match, search by hand" state; BGG rate-limit exhaustion degrades to local results. (Task 2, Task 6, Task 7)
4. Robustness and performance: a 12-megapixel or 20 MB photo, a corrupt or non-image file, EXIF-rotated photos, camera permission denied, WebAssembly blocked, a 20 s timeout, leaving the page mid-identification (workers terminated), and no OCR/barcode code in the initial bundle. (Task 5, Task 7)
5. Cover hashing is safe and consistent: no SSRF (allowlist, https, redirects), size/time caps, never breaks the import, and server and browser hashes of the same image agree within distance 6. (Task 4, Task 7)

---

## File Structure

```
supabase/migrations/20261116190000_recognition.sql
tests/integration/rls-recognition.test.ts
scripts/copy-ocr-assets.mjs                      (copies tesseract core + language data into public/tesseract)
scripts/backfill-cover-hashes.mjs                (hashes covers of games imported before this phase)
scripts/eval-recognition.mjs                     (measurement harness; not in CI)
src/features/recognition/
  gtin.ts  dhash.ts  text.ts  merge.ts  recognizer.ts      (+ *.test.ts)  pure, dependency-free, relative imports only
  cover-hash.ts (server: fetch + sharp)  services/recognition-service.ts  actions/recognition-actions.ts
  browser/image-prep.ts  browser/barcode.ts  browser/ocr.ts  browser/pipeline.ts
  components/identify-game.tsx  components/candidate-list.tsx
  index.ts (server barrel)  client.ts (client barrel)
src/features/catalog/services/import-service.ts   (modify: hash the cover after a successful import)
src/app/[locale]/(app)/games/(list)/page.tsx      (modify: "Identify by photo")
next.config.ts                                    (modify: security headers)
tests/e2e/app-recognition.spec.ts, tests/e2e/helpers.ts, tests/e2e/auth.setup.ts, tests/e2e/fixtures/ (generated images)
docs/ROADMAP.md, DATABASE.md, SECURITY.md, DECISIONS.md (ADR-036)
```

---

### Task 1: Verify the BGG adapter against the live API

Precondition: the user has put `BGG_API_TOKEN` in `.env.local`. Without it, this task is skipped and the ledger says so; Tasks 2–4 do not depend on it but Task 6 and the E2E in Task 7 use BGG text search and degrade to local-only when it is unavailable.

**Files:**
- Create: `tests/integration/bgg-live.test.ts` (skipped without the token and DB)
- Modify: `src/features/catalog/sources/bgg/*` and its fixtures only if the live API disagrees with them

**Interfaces:**
- Consumes: `getGameSource()` from `@/features/catalog`.
- Produces: confidence that `search(query)` and `fetchGame(externalId)` match the real API; adapter fixtures reflect real responses.

- [ ] **Step 1: Write the live test first**: `getGameSource().isConfigured()` is true; `search("Catan")` returns hits with `externalId` and a name; `fetchGame` of a returned id returns a game that passes the existing external schema (`external-game.schema.ts`); a nonsense query returns `[]`, not an error; an invalid token (temporarily overriding the env in the test) maps to `unauthorized`. Use `describe.skipIf(!process.env.BGG_API_TOKEN)`; never print the token.
- [ ] **Step 2: Run it** — `npm run test:integration -- tests/integration/bgg-live.test.ts`. Expected: either PASS (adapter correct) or FAIL showing exactly how the real API differs.
- [ ] **Step 3: If it failed, fix the adapter** (and refresh its recorded fixtures from the real responses, trimmed), keeping the unit tests green. Record in the ledger what differed.
- [ ] **Step 4: Run the full unit suite, lint, typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** — `test(catalog): verify the BGG adapter against the live API`.

---

### Task 2: Pure recognition toolkit

**Files:**
- Create: `src/features/recognition/{gtin.ts,dhash.ts,text.ts,merge.ts,recognizer.ts}` and a `.test.ts` for each

**Interfaces (all pure, no imports outside this folder, so a Node script can load them with type stripping):**
- `gtin.ts`: `parseGtin(raw: string): string | null` (digits only, EAN-8, UPC-A/EAN-12→13 normalized to 13 digits, EAN-13; valid check digit; else null).
- `dhash.ts`: `dHashFromGray(gray: ArrayLike<number>): string` (input exactly 9×8 = 72 luminance values row-major; returns 16 lowercase hex chars; bit set when a pixel is brighter than its right neighbour); `hamming(a: string, b: string): number` (0–64; throws on malformed hex); `isHash(s: string): boolean`; constants `HASH_WIDTH = 9`, `HASH_HEIGHT = 8`.
- `text.ts`: `normalizeTitle(s: string): string` (NFD, strips Latin diacritics U+0300–U+036F like `normalizePlayerName`, lower-case, non-alphanumerics → space, collapse); `textSimilarity(a: string, b: string): number` (0–1, trigram Jaccard on normalized strings; 0 for empty); `cleanOcrLines(lines: { text: string; confidence: number; height: number }[], max = 3): string[]` (drop confidence < 50 or < 3 alphanumerics, cap length at 80, dedupe by normalized text, prefer larger `height` then higher confidence, return at most `max`).
- `merge.ts`: `type Reason = "code" | "title" | "image"`; `type Candidate = { gameId: string | null; externalId: string | null; name: string; score: number; reasons: Reason[] }`; `mergeCandidates(signals: { reason: Reason; gameId: string | null; externalId: string | null; name: string; strength: number }[], limit = 5): Candidate[]` — groups by `gameId` (or `externalId` when no gameId), `score = min(1, 0.95·code + 0.7·title + 0.35·image)` using each signal's strength in 0–1 (max strength per reason), reasons sorted code, title, image, results sorted by score desc then name, at most `limit`.
- `recognizer.ts`: `interface GameRecognizer { id: string; requiresConsent: boolean; recognize(input: RecognizerInput): Promise<Candidate[]> }`; `type RecognizerInput = { gtin?: string; lines?: string[]; hash?: string }`; `runRecognizers(recognizers: GameRecognizer[], input: RecognizerInput, consent: ReadonlySet<string>): Promise<Candidate[]>` — skips (never calls) any recognizer with `requiresConsent` whose id is not in `consent`, isolates failures (a throwing recognizer is skipped), merges nothing itself.

- [ ] **Step 1: Write the tests first**, with these exact cases: `parseGtin("9783161484100")` valid, same with a wrong last digit → null, UPC-A `"036000291452"` → `"0036000291452"`, EAN-8 `"96385074"` valid, `"abc"`/`""`/15 digits → null, spaces and hyphens tolerated; `dHashFromGray` of a constant image is `"0000000000000000"`, of a strictly decreasing row pattern is all `f`, is invariant to adding a constant or scaling all pixels, `hamming("0000000000000000","ffffffffffffffff") = 64`, `hamming(x,x) = 0`, malformed hex throws; `normalizeTitle("Catán: 5ª Ed.!")` → `"catan 5a ed"`; `textSimilarity("Catan","catán") = 1`, `textSimilarity("Catan","Azul") < 0.2`, empty → 0, a typo `("Wingspan","Wingspn")` > 0.5; `cleanOcrLines` drops low confidence/short/duplicates, orders by height, caps at 3, truncates a 500-char line to 80, ignores a line of emoji only; `mergeCandidates` weights (code alone 0.95, title alone ≤ 0.7, image alone ≤ 0.35, code+title capped at 1), groups a catalog hit and a BGG hit with the same `gameId`, orders deterministically, respects `limit`; `runRecognizers` never calls a consent-requiring recognizer without consent, calls it with consent, and survives one that throws.
- [ ] **Step 2: Run to see it fail** — `npx vitest run src/features/recognition`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the five modules.
- [ ] **Step 4: Run unit suite, lint, typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(recognition): pure toolkit (gtin, dhash, text, merge, recognizers)`.

---

### Task 3: Migration 0016 — barcodes and image hashes

**Files:**
- Create: `supabase/migrations/20261116190000_recognition.sql`, `tests/integration/rls-recognition.test.ts`
- Modify: `docs/DATABASE.md`, `docs/SECURITY.md`

**Interfaces:**
- Produces (SQL):
  - Table `game_barcodes(user_id text default current_user_id() fk profiles on delete cascade, gtin text check ^[0-9]{13}$, game_id uuid fk games on delete cascade, created_at)`, primary key (`user_id`,`gtin`); RLS owner-only (select/insert/update/delete); the game must be visible (insert policy `exists (select 1 from games where id = game_id)`); cap **500 per user** by trigger locking the profile row; column grants `insert (gtin, game_id)`, `update (game_id)`.
  - Table `game_image_hashes(id uuid pk, game_id uuid fk games on delete cascade, owner_id text null fk profiles on delete cascade, source text check in ('cover','user_photo'), hash bigint, created_at)`; CHECK `(source = 'cover') = (owner_id is null)`; unique `(game_id)` where source = 'cover'; unique `(owner_id, game_id, hash)` where source = 'user_photo'; RLS select: `source = 'cover'` and the game visible, or `owner_id = current_user_id()`; **no insert/update/delete for `authenticated` directly**; cap **20 user photos per user and game** (trigger).
  - `save_photo_hash(p_game_id uuid, p_hash text) returns void` (`security invoker`, `authenticated`): validates `^[0-9a-f]{16}$`, game visible (`P0002` otherwise), inserts `user_photo` for the caller with `on conflict do nothing` (the grant allows `insert` only through this function: grant `insert` on the table to `authenticated` with a policy `source = 'user_photo' and owner_id = current_user_id()` is acceptable instead; pick one and test it).
  - `upsert_cover_hash(p_game_id uuid, p_hash text) returns void` (`security definer`, **`service_role` only**): upserts the `cover` row.
  - `match_game_images(p_hash text, p_max_distance int default 12, p_limit int default 5) returns table (game_id uuid, distance int)` (`security invoker`, `authenticated`): per game the minimum `bit_count(((('x' || h.hash_hex)::bit(64)) # ('x' || p_hash)::bit(64)))` over rows visible to the caller (convert the stored `bigint` to `bit(64)` for the XOR), distance ≤ `p_max_distance` (0–64 clamped), ordered by distance then game id, limit 1..20; invalid hash → `22023`.

- [ ] **Step 1: Write `rls-recognition.test.ts` first** (pattern of `rls-stats.test.ts`): user A saves a barcode and a photo hash, B sees neither and cannot insert for A; barcode for a game A cannot see → refused; invalid gtin (12 digits, letters) refused; the 501st barcode refused and the 21st hash per game refused (race-free: two parallel inserts cannot exceed); `update` cannot change `gtin`/`user_id`; cover hash inserted via `service_role` is visible to any authenticated user who can see the game and invisible when the game is a private custom game of someone else; `authenticated` cannot call `upsert_cover_hash` or write `cover` rows directly; `match_game_images` returns exact match at distance 0, a 3-bit-different hash at 3, nothing beyond the threshold, merges cover and own photo into the minimum per game, never leaks another user's photo hashes, rejects bad hex with `22023`; deleting a game or a profile leaves no orphans; `anon` has no access.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL (objects missing).
- [ ] **Step 3: Write the migration**, rehearse it in a rolled-back transaction against dev, then **ask the user before `db push`**; apply; regenerate `src/lib/supabase/database.types.ts` (`npm run db:types`, then prettier on it).
- [ ] **Step 4: Run the new tests and the whole integration suite.** Expected: PASS, no regression (197 + new).
- [ ] **Step 5: Docs and commit** — DATABASE.md (§ recognition, migration list), SECURITY.md (matrix rows); `feat(db): barcodes and image hashes`.

---

### Task 4: Cover hashes at import, and a backfill

**Files:**
- Create: `src/features/recognition/cover-hash.ts` (+ `cover-hash.test.ts`), `scripts/backfill-cover-hashes.mjs`
- Modify: `src/features/catalog/services/import-service.ts`, `package.json` (only if `sharp` is not already a resolvable dependency)

**Interfaces:**
- Consumes: `dHashFromGray`, `HASH_WIDTH/HEIGHT` (Task 2); `upsert_cover_hash` (Task 3); an `ImportStore`-style seam for tests.
- Produces: `isAllowedCoverUrl(url: string): boolean` (https only, host in `["cf.geekdo-images.com", "cf.geekdo-static.com"]` plus subdomains of `geekdo-images.com`/`geekdo-static.com`; no credentials, no IP-literal hosts); `fetchCoverBytes(url: string, fetchImpl = fetch): Promise<Uint8Array | null>` (timeout 5 s, ≤ 2 MB while streaming, redirect `manual` and re-validated against the allowlist up to 2 hops, content-type `image/*`, null on any failure); `hashCoverBytes(bytes: Uint8Array): Promise<string | null>` (`sharp`: rotate by EXIF, flatten to white, grayscale, resize to exactly 9×8 with `fit: "fill"`, raw → `dHashFromGray`; null when undecodable); `hashCover(url: string): Promise<string | null>`; in `import-service`, after a successful import with a `coverUrl`, call `hashCover` then `upsert_cover_hash` through the service-role client **inside a try/catch that only logs**.

- [ ] **Step 1: Write `cover-hash.test.ts` first**: `isAllowedCoverUrl` accepts the geekdo hosts over https and rejects http, other hosts, `https://127.0.0.1/…`, `https://[::1]/…`, `https://user:pw@cf.geekdo-images.com/…`, `https://cf.geekdo-images.com.evil.com/…`; `fetchCoverBytes` with an injected fetch returns null for: a redirect to a non-allowlisted host, a 3rd redirect hop, a non-image content-type, a body over 2 MB (stops reading), a timeout, a network error; returns bytes for a normal response; `hashCoverBytes` on a generated PNG (create with `sharp` in the test: a left-to-right gradient and a checkerboard) gives deterministic different hashes, the same image re-encoded as JPEG (quality 70) and downscaled 50% stays within Hamming ≤ 6, a transparent PNG is hashed over white, corrupt bytes → null; an import with a cover calls the store once and **an exception in hashing or storing never fails the import** (existing import tests keep passing with the seam stubbed).
- [ ] **Step 2: Run to see it fail.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `cover-hash.ts` and the best-effort hook in `import-service.ts`; confirm `sharp` resolves (`node -e "require('sharp')"`); add it to `package.json` only if it does not.
- [ ] **Step 4: Write `scripts/backfill-cover-hashes.mjs`**: loads `src/features/recognition/{dhash,cover-hash}.ts` by relative path with Node type stripping, reads games with a `cover_url` and no `cover` hash via the service-role client, hashes at most 5 per second, prints counts, is idempotent, refuses to run without `--yes`. Run it once against dev (ask the user first: it fetches ≤ a few dozen covers and writes rows) and record the count.
- [ ] **Step 5: Run unit suite, lint, typecheck, integration, then commit** — `feat(recognition): cover hashes at import and a backfill script`.

---

### Task 5: Browser engines (image prep, barcode, OCR) and self-hosted assets

**Files:**
- Create: `src/features/recognition/browser/{image-prep.ts,barcode.ts,ocr.ts,pipeline.ts}`, `scripts/copy-ocr-assets.mjs`, tests for the pure parts
- Modify: `package.json` (`tesseract.js`, `@tesseract.js-data/eng|spa|fra` as needed, `zxing-wasm`; scripts `predev`/`prebuild` run `copy-ocr-assets.mjs`), `.gitignore` (`public/tesseract/`)

**Interfaces:**
- Consumes: `dHashFromGray`, `HASH_*`, `parseGtin`, `cleanOcrLines` (Task 2).
- Produces (browser-only, dynamically imported by the pipeline):
  - `prepareImage(file: File): Promise<{ canvas: OffscreenCanvas | HTMLCanvasElement; width: number; height: number }>`: rejects non-images and files over 20 MB with `ImageError("not_image" | "too_large" | "unreadable")`, honors EXIF orientation (`createImageBitmap(file, { imageOrientation: "from-image" })`), downscales so the longest side ≤ 1280.
  - `grayFor9x8(canvas): number[]` (draw to a 9×8 canvas with smoothing, luminance `0.299r+0.587g+0.114b`) and `imageHash(canvas): string`.
  - `readBarcode(canvas): Promise<string | null>`: `BarcodeDetector` (`ean_13`, `ean_8`, `upc_a`) when available else `zxing-wasm`; returns `parseGtin(raw)`.
  - `readTitleLines(canvas, locale: "en" | "es" | "fr", signal: AbortSignal): Promise<string[]>`: Tesseract worker with `workerPath`/`corePath`/`langPath` under `/tesseract/`, languages `eng` + the locale's; lines → `cleanOcrLines`; always `terminate()`s the worker (also on abort).
  - `identifyPhoto(file: File, opts: { locale; signal; onStage(stage: "prepare" | "code" | "text" | "image"): void }): Promise<{ gtin: string | null; lines: string[]; hash: string }>`: stages in order `prepare → code → text → image` (image hash is cheap and always computed; barcode and OCR run sequentially to avoid two WASM runtimes at once on phones), 20 s overall timeout (`ImageError("timeout")`), `WebAssembly` missing → barcode/OCR skipped and the result still carries the hash with `unsupported: true`.

- [ ] **Step 1: Write the tests first** for what is testable in Vitest: `ImageError` mapping helpers, the 9×8 luminance function over a synthetic RGBA array, the stage/timeout orchestration with stubbed engines (inject the engines into `identifyPhoto`'s internals), abort terminates the worker (stub), a barcode result goes through `parseGtin`. Real engines are exercised in Task 7's E2E.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the modules; read the `tesseract.js` and `zxing-wasm` docs via Context7 first (worker/core path options differ between major versions); implement `copy-ocr-assets.mjs` (copies the worker, the core wasm/js variant actually used, and `*.traineddata(.gz)` for eng/spa/fra into `public/tesseract/`; fails loudly if a source file is missing; idempotent); wire `predev`/`prebuild`; add `public/tesseract/` to `.gitignore`.
- [ ] **Step 4: Verify the bundle**: `npm run build`, then confirm the OCR/barcode code is in async chunks only (inspect `.next` build output: no `tesseract` or `zxing` string in the first-load chunks of `/[locale]/games`), and record the size of `public/tesseract/` in the ledger.
- [ ] **Step 5: Run unit suite, lint, typecheck, then commit** — `feat(recognition): browser engines and self-hosted OCR assets`.

---

### Task 6: Candidates service and actions

**Files:**
- Create: `src/features/recognition/services/recognition-service.ts` (+ test), `src/features/recognition/actions/recognition-actions.ts`, `src/features/recognition/index.ts`, `src/features/recognition/client.ts`

**Interfaces:**
- Consumes: Task 2 pure modules; `searchLocalGames` and `searchExternalGames` + `getGameSource` from catalog; RPCs `match_game_images`; table `game_barcodes`; `save_photo_hash`.
- Produces:
  - Zod schema `identifyInputSchema = { gtin?: 13 digits; lines: string[] (0–3, each 1–80 chars); hash?: 16 lowercase hex }` (strict; at least one of the three present).
  - `identifyGame(input, deps): Promise<{ candidates: Candidate[]; bggLimited: boolean }>` where `deps` injects the catalog/BGG/DB access for testing: (1) a barcode hit gives a `code` signal of strength 1 for the owner's mapped game; (2) each title line → `searchLocalGames(line)` (top 5) with strength = `textSimilarity(line, name)`; (3) **only if the best title strength is < 0.6 and the source is configured and not rate limited**, at most **2** BGG searches (the two best lines) → hits become signals (`gameId` from the store when already imported, else `externalId`); rate-limited/unavailable sets `bggLimited` without failing; (4) `match_game_images` → `image` signals with strength `1 - distance / 12`; then `mergeCandidates(signals, 5)`.
  - Actions (`"use server"`, auth required, `unstable_rethrow`): `identifyGameAction(input)`, `learnBarcodeAction({ gtin, gameId })` (upsert into `game_barcodes`; `23505` race handled; `23503`/`42501` → `not_found`; cap error → `limit`), `savePhotoHashAction({ gameId, hash })` → `save_photo_hash`. All return `{ ok: true, … } | { ok: false, error }` with stable error codes.
  - `index.ts` (server) and `client.ts` (types, pure helpers, browser pipeline entry; no server-only imports).

- [ ] **Step 1: Write `recognition-service.test.ts` first** with injected fakes: barcode hit alone → one candidate with reason `code`; a strong local title match performs **zero** BGG calls; weak/no local match performs at most 2 BGG calls (3 lines given, 2 used); rate limited → local/other signals returned and `bggLimited: true`; BGG unconfigured → `bggLimited: true` without calling; local and BGG hits for the same game merge into one candidate; an image hit alone never scores above 0.35; garbage lines (`"💥💥💥"`, a 500-char string, markup like `<img src=x onerror=alert(1)>`) never throw and yield text-only candidates or none; `identifyInputSchema` rejects a 4th line, an 81-char line, a 12-digit gtin, uppercase/short/long hash and an empty object.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement** service, actions and barrels; learned barcodes and own hashes use the user's RLS client; BGG usage goes through the existing store/rate limit.
- [ ] **Step 4: Run unit suite, lint, typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(recognition): candidates service and actions`.

---

### Task 7: "Identify by photo" UI and E2E

**Files:**
- Create: `src/features/recognition/components/{identify-game.tsx,candidate-list.tsx}`, `tests/e2e/app-recognition.spec.ts`, helpers to generate fixture images
- Modify: `src/app/[locale]/(app)/games/(list)/page.tsx`, messages en/es/fr (`Recognition.*`), `tests/e2e/helpers.ts`, `tests/e2e/auth.setup.ts`

**Interfaces:**
- Consumes: Tasks 5 and 6 (`identifyPhoto`, `identifyGameAction`, `learnBarcodeAction`, `savePhotoHashAction`), `importGameAction`.
- Produces: `<IdentifyGame bggAvailable />` client component; flow: a labelled button "Identify by photo" (opens the file chooser; `capture="environment"`; also accepts a gallery file) → a status region (`role="status"`) shows the stage ("Preparing the photo…", "Looking for a barcode…", "Reading the title…", "Comparing the picture…") with a Cancel button (aborts and terminates workers) → a `<ol aria-label>` list of up to 5 candidates, each with the game name, the reason chips ("Barcode", "Title", "Picture") and a confidence word (High ≥ 0.8, Medium ≥ 0.5, Low otherwise; **never "certain"**), and a "This is it" button → imports first when the candidate has no `gameId` (existing `importGameAction`), then if a barcode was read `learnBarcodeAction`, and `savePhotoHashAction` for the photo's hash, then navigates to the game page → a "None of these: search by hand" link to the list with `?q=` set to the best title line; empty result and every `ImageError` have their own translated message; a privacy line "The photo stays on your device." is always visible; if `unsupported`, a note that only the picture comparison ran.

- [ ] **Step 1: Write the E2E spec first** (`app-recognition.spec.ts`, user `n`, prefix `9908`; fixtures inserted through the DB with `insertImportedGame`; images generated in the page with a canvas and passed to `setInputFiles` as buffers; an EAN-13 drawn from a small pure bar-pattern helper in the test): a box image with large title text "WINGSPAN" finds the fixture game "Wingspan E2E" at the top with reason "Title"; an EAN-13 image first yields nothing from the code, the user picks the game via title/manual, **the code is learned**, and the same barcode image next time returns it with reason "Barcode" and High confidence; a picture whose hash equals a stored cover hash (insert via `upsert_cover_hash`) returns it with reason "Picture" and **never above Medium**; a blank image and a noise image give the honest empty state with the manual-search link; a text file renamed `.jpg`, a 21 MB file and a corrupt PNG show their own errors and leave the page usable; cancel mid-identification leaves no `tesseract`-worker request pending and the button usable again; **privacy**: record every request during an identification (`page.on("request")`): none has `postData` containing image bytes or a `multipart`/`image/*` content type, none goes to a third-party host, and the only app POST bodies are the identify action's small JSON (assert size < 1 KB); with `WebAssembly` removed (`addInitScript`) the flow still returns picture-based candidates and shows the note; the OCR/barcode assets load only after clicking the button (no `/tesseract/` request on first page load); **hash parity**: the fixture cover image hashed by `hashCoverBytes` (server, via a tiny test-only route is NOT allowed: compute it in the spec with the same `sharp` code from the toolkit) and by the browser pipeline in the page agree within Hamming ≤ 6; a user cannot see candidates from another user's learned barcodes (second user, same code); axe light/dark on the idle state and the results list; at 375 px no sideways scroll and the buttons are ≥ 44 px; es and fr strings render.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL (no button).
- [ ] **Step 3: Implement** the components, page wiring and messages (en/es/fr), the user `n` helpers; read Next 16 docs for the client/server boundaries used.
- [ ] **Step 4: Run lint, typecheck, unit, the new E2E, then the full E2E suite.** Expected: all PASS (retried flakes are listed in the ledger, not hidden).
- [ ] **Step 5: Commit** — `feat(recognition): identify a game by photo`.

---

### Task 8: Security headers and a CSP that allows the local engines

**Files:**
- Modify: `next.config.ts` (`headers()`), `tests/e2e/app-layout.spec.ts` or a new `tests/e2e/security-headers.spec.ts`, `docs/SECURITY.md`

**Interfaces:**
- Produces: on every route `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera allowed for self only; geolocation/microphone off), `X-Frame-Options`-equivalent via CSP `frame-ancestors 'none'`, and a `Content-Security-Policy` whose `script-src` includes `'self'` and `'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src` for self, Supabase and Clerk, `img-src` for self, data:, blob: and the geekdo image hosts, `frame-src` for the YouTube privacy-enhanced domain and Clerk, `style-src` as the app needs.

- [ ] **Step 1: Read the current Clerk and Next 16 guidance via Context7/`node_modules/next/dist/docs/` for CSP with Clerk (script and connect domains, nonces vs `'unsafe-inline'`) and decide the minimum policy that keeps sign-in working.** Record the choice (nonce or hash vs inline) in the ledger as a ruling.
- [ ] **Step 2: Write the E2E first**: every route family returns the headers above; the full suite (sign-in via Clerk, charts, YouTube facade, game photos, identification with WASM and workers) runs with **no CSP violation** reported (`page.on("console")` filtering "Content Security Policy"); a deliberately injected inline script in a test page is blocked only if the chosen policy forbids inline.
- [ ] **Step 3: Ship the CSP as `Content-Security-Policy-Report-Only` first** if the full suite shows any production-only uncertainty (Clerk production domain is not testable here), the other headers enforced; ledger the decision and the exact follow-up to switch to enforcing after a deploy has been observed. If every E2E is violation-free and Clerk docs confirm the domains, enforce directly.
- [ ] **Step 4: Run lint, typecheck, unit and the full E2E suite.** Expected: PASS, zero CSP console errors.
- [ ] **Step 5: Docs and commit** — SECURITY.md (headers, CSP mode, what is pending); `feat(security): headers and a CSP compatible with local recognition`.

---

### Task 9: Measurement harness, decision gate and docs

**Files:**
- Create: `scripts/eval-recognition.mjs`
- Modify: `docs/ROADMAP.md`, `docs/DATABASE.md`, `docs/DECISIONS.md` (ADR-036), `docs/SECURITY.md`

**Interfaces:**
- Produces: `node scripts/eval-recognition.mjs <folder>` reading `<folder>/*.jpg|png|webp` and `<folder>/labels.json` (`{ "file.jpg": "<games.id or exact catalog name>" }`); for each photo it runs, with the same toolkit and Node builds of `tesseract.js`/`zxing-wasm`/`sharp`, the barcode, title and hash signals separately and combined against the dev catalog (service-role read), printing per technique and combined: top-1 and top-5 hit rates, mean time, and the photos with no signal.

- [ ] **Step 1: Write the harness**; add a tiny self-check mode (`--self-test`) that runs on two generated images so the script itself is verified without user photos.
- [ ] **Step 2: Ask the user for 15–20 real photos of their boxes and a `labels.json`** (kept outside the repo; never committed). Run the harness and put the numbers in the ledger and ADR-036. **Decision gate:** if the picture signal adds no measurable top-5 hits over barcode + title, remove it (revert the image candidates, keep the tables/functions as dormant or drop them in a follow-up migration) **before** merging, and say so in the final message; if no photos are provided, ship with the picture signal weighted as designed and mark the gap explicitly as unmeasured.
- [ ] **Step 3: Docs**: ROADMAP "Estado de la Fase 7a" table with the final counts and measured numbers; DECISIONS ADR-036 (local recognition, transient cover hashing, privacy rule, consent-gated extension point, the measured results, CSP mode).
- [ ] **Step 4: Run the full verification** (`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, integration, full E2E). Expected: all PASS.
- [ ] **Step 5: Commit** — `docs: Phase 7a`.
