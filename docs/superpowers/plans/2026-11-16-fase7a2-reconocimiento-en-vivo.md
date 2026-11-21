# Phase 7a-2 — Live camera game recognition (CLIP + OpenCV.js): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (opt-in, off by default):** The user can enable the feature on a device (one-time ~85 MB download, explained before it starts); once enabled they open the camera (no photo needed), points it at a game box and sees "Looks like X" with an honest confidence; they confirm by hand. Everything runs on the device, free, and it replaces the OCR and image-hash signals of 7a (which measured 1–3/15 on the user's real photos).

**Architecture:** A Web Worker runs CLIP ViT-B/32 (quantized ONNX, via Transformers.js, self-hosted) on camera frames and returns 512-number vectors; they are ranked by cosine similarity against reference vectors of the catalog covers (computed once per device from our own cover endpoint, cached in IndexedDB; confirmed frames are added as extra references). A voter over the last frames locks a candidate; OpenCV.js (ORB + RANSAC, lazy-loaded) verifies the top candidates; a learned barcode (BarcodeDetector / zxing-wasm) overrides. Pure logic (cosine, voting, confidence) is shared and unit tested. The OCR, 64-bit hash, `game_image_hashes` and their code are removed.

**Tech Stack:** Next.js 16, TypeScript strict, Zod 4, `@huggingface/transformers` (Transformers.js 4.x) with ONNX Runtime Web (wasm, single thread), `@techstark/opencv-js`, `fake-indexeddb` (tests only), Supabase, next-intl (en/es/fr), Vitest, Playwright (fake camera).

**Spec:** `docs/superpowers/specs/2026-11-16-fase7a2-reconocimiento-en-vivo-design.md`. Evidence: ADR-036 and its addendum (15 real photos vs 65 covers: CLIP 13/15, ORB 10/15, OCR+hash 1–3/15).

## Global Constraints

- Before writing any Next.js code read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md); Next 16: `proxy.ts`; wrap every `catch` around `auth()` with `unstable_rethrow`. Use Context7 for Transformers.js, ONNX Runtime Web and OpenCV.js questions.
- **No frame ever leaves the device.** The network carries only: requests to our own `/api/covers/[gameId]` (covers of games the user can already see), the one-time download of the model and engines from OUR host, and the existing small candidate/learn actions. No external AI service, no CDN at run time (`env.allowRemoteModels` stays enforced to our host; ONNX `wasmPaths` self-hosted).
- Only the current stack: no Rust or other languages. Open-source libraries, local processing, zero cost. Any future external AI stays optional, off by default and consent-gated (`GameRecognizer` is kept).
- **The feature is OFF by default and per device.** Until the user explicitly activates it nothing is downloaded or loaded: no model request, no engine request, no worker, no references built; the Games page shows only an "Enable" card. The 85 MB warning is shown BEFORE any download and the download starts only on the user's confirmation (cancellable, retryable). Once installed it stays available; Settings can disable it and delete the model (Cache API) and the stored vectors (IndexedDB). The enabled flag lives in `localStorage` of that device (never on the server); `createEmbedder` must refuse to run (never auto-download) when the model is not installed.
- Heavy code (Transformers.js, ONNX wasm, OpenCV.js) is dynamically imported only when the user opens the camera/photo flow; none of it appears in the first-load JS of any route (E2E asserts it). Model files are **never committed**: `public/models/` and `public/ort/` and `public/opencv/` are git-ignored copies made by `scripts/copy-model-assets.mjs` (model from the local Hugging Face cache or a one-time download; ONNX/OpenCV from `node_modules`). The model is ~85 MB: production hosting (Supabase Storage public bucket vs `public/`) is decided in Task 3 against the deployment size limit and recorded as a ruling.
- Honest confidence: "high" only with a learned barcode or a strong ORB verification; never "certain"; never lock a candidate whose lead over the runner-up is below the calibrated margin; always manual confirmation. The thresholds live in ONE file (`embedding/thresholds.ts`) and are calibrated in Task 5 with the user's 15 photos (kept outside the repo in `<eval-dir>`, with `labels.resolved.json`).
- Camera hygiene: stop every `MediaStream` track on stop/unmount/tab hidden, process a frame only if the previous one finished, auto-stop after 90 s without a lock, never run in an insecure context without saying so, handle permission denied / no camera / no WebAssembly with their own translated message.
- The cover endpoint reuses the existing SSRF guard (`isAllowedCoverUrl`, `fetchCoverBytes`: https, geekdo allowlist, bounded redirects, 5 MB, 5 s) and RLS (only games the viewer can see).
- No hard-coded UI strings: `src/i18n/messages/{en,es,fr}.json` with identical keys. Hostile text (names) shown as text.
- DB: migration 0017 only DROPS the 7a hash objects (tables/functions); `game_barcodes` stays. **Ask the user before `npx supabase db push`.** Rehearse in a rolled-back transaction first.
- E2E fixture prefix `9909` (taken: 9900–9908), test user `o` (add to `TEST_USERS`/`STATE_FILE` in `tests/e2e/helpers.ts` and to `auth.setup.ts`). Spec files must be named `app-*.spec.ts`; CPU-heavy ones go in the `app-heavy` project (`HEAVY` regex in `playwright.config.ts`).
- Never import `cn` from `"cn"` (ADR-016).
- Commit after each task. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the `Claude-Session:` line the harness provides.

## Review Focus

1. No frame leaves the device: an E2E intercepts every request during a live session and asserts no request carries image bytes, nothing goes to a third-party host, and the only app requests are cover fetches, the one-time model/engine downloads from our origin and the small action calls. (Task 3, Task 6)
2. The cover endpoint cannot be abused: unauthenticated → 401; a game the user cannot see (another user's custom game) → 404 indistinguishable from "no such game"; non-geekdo covers, SSRF-shaped URLs, oversized or non-image bodies → refused; output is a bounded JPEG. (Task 2)
3. Wrong answers are never presented as certain: ambiguous top-2, empty catalog, a camera showing a non-game (hand, wall, a different edition), a game not in the catalog, low light/blur; "high" only with barcode/ORB evidence; a stable wrong lock cannot be confirmed without the user's click. (Task 1, Task 5, Task 6)
4. Opt-in is real: on a fresh profile there is zero model/engine traffic and no heavy code loaded; the size warning precedes the first download byte; cancelling or failing leaves nothing half-installed and the feature stays off; disable truly frees the model cache and the vectors; reload keeps the enabled state without re-downloading. Resources and robustness: camera tracks stopped on every exit path, worker terminated, frames skipped while busy, OpenCV `Mat`/matcher objects deleted (no leak over 100 verifications), model download progress/failure/retry/offline, IndexedDB unavailable or full (private mode) degrades to in-memory references, multi-tab races, 85 MB only fetched on first use. (Task 3, Task 4, Task 6)
5. Retirement is complete and safe: no dangling OCR/hash code, assets, dependencies, scripts, messages or E2E; the migration drops only what 7a created and leaves `game_barcodes`; import still works without the hash hook. (Task 7)

---

## File Structure

```
src/features/recognition/
  embedding/thresholds.ts  rank.ts  vote.ts  confidence.ts  (+ tests)      pure
  embedding/model.ts  embed.worker.ts  (browser)                           CLIP in a worker
  embedding/reference-store.ts  build-references.ts  (+ tests)             IndexedDB + orchestration
  verify/orb.ts  (+ test, Node-run OpenCV)                                 ORB + RANSAC verifier
  live/frames.ts  use-live-recognition.ts                                  camera loop, voting
  components/live-recognition.tsx  (replaces identify-game.tsx)
  components/recognition-activation.tsx  (the off-by-default card + 85 MB confirmation + progress)
  components/recognition-settings.tsx  (status, disable and delete data; in Settings)
  embedding/activation.ts  (enabled flag in localStorage, model install/remove/status)
  cover-fetch.ts  (moved from cover-hash.ts: SSRF-guarded fetch only)
src/app/api/covers/[gameId]/route.ts
scripts/copy-model-assets.mjs   scripts/eval-recognition.mts (rewritten for the new pipeline)
supabase/migrations/20261116200000_drop_image_hashes.sql
tests/e2e/app-live-recognition.spec.ts  tests/support/y4m.ts (fake camera feed)  tests/integration/rls-recognition.test.ts (trim)
docs/ROADMAP.md  DATABASE.md  SECURITY.md  DECISIONS.md (ADR-036/037)
```

---

### Task 1: Pure core — cosine ranking, frame voting, confidence

**Files:** Create `src/features/recognition/embedding/{thresholds.ts,rank.ts,vote.ts,confidence.ts}` and a test for each.

**Interfaces (all pure, no imports outside the folder):**
- `thresholds.ts`: exported constants `EMBED_DIM = 512`, `VOTE_WINDOW = 5`, `VOTE_MIN = 3`, `LOCK_MIN_SIMILARITY`, `LOCK_MIN_MARGIN`, `MEDIUM_MIN_SIMILARITY`, `MEDIUM_MIN_MARGIN`, `ORB_HIGH_INLIERS`, `ORB_MEDIUM_INLIERS` — initial values `0.45, 0.02, 0.55, 0.04, 40, 15` (placeholders, calibrated in Task 5).
- `rank.ts`: `type Vec = Float32Array` (L2-normalized, length `EMBED_DIM`); `type Reference = { gameId: string; vec: Vec; kind: "cover" | "learned" }`; `normalize(v: ArrayLike<number>): Vec` (throws on zero vector or wrong length); `cosine(a: Vec, b: Vec): number`; `rankByCosine(query: Vec, refs: Reference[]): { gameId: string; score: number; kind: "cover" | "learned" }[]` — best score per game, descending, ties by `gameId`; empty refs → `[]`.
- `vote.ts`: `createVoter(opts?: { window?: number; minVotes?: number; minSimilarity?: number; minMargin?: number })` → `{ push(ranked): Lock | null; reset(): void }` where `type Lock = { gameId: string; similarity: number; margin: number; votes: number }`; a frame votes for its top-1 only when its similarity ≥ `minSimilarity`; the lock needs `minVotes` of the last `window` frames for the same game and a mean margin (top1 − top2 of those frames; no runner-up = margin 1) ≥ `minMargin`; returns `null` otherwise; a different game taking over resets the lead.
- `confidence.ts`: `type Level = "high" | "medium" | "low"`; `levelFor(i: { similarity: number; margin: number; orbInliers?: number; learnedBarcode?: boolean }): Level` — `learnedBarcode` → high; `orbInliers ≥ ORB_HIGH_INLIERS` → high; (`orbInliers ≥ ORB_MEDIUM_INLIERS` or `similarity ≥ MEDIUM_MIN_SIMILARITY && margin ≥ MEDIUM_MIN_MARGIN`) → medium; else low. Never returns anything above "high".

- [ ] **Step 1: Write the tests first** with exact cases: `normalize` gives unit length and rejects `[0,0,…]` and length ≠ 512; `cosine` of a vector with itself = 1 (±1e-6), of orthogonal = 0; `rankByCosine` returns one row per game with the best of its references (a "learned" reference can beat the cover), ordered desc with ties by id, `[]` for no references; `createVoter`: 5 frames all pointing at game A with margin 0.1 → lock on the 3rd frame; alternating A,B,A,B,A → no lock until A has 3 of 5 and it must also clear the margin; a frame below `minSimilarity` never votes; margin 0.005 (A/B nearly tied) → never locks; after `reset()` no memory; a lock for A disappears (null) if B takes ≥ 3 of the last 5; `levelFor` truth table (barcode → high regardless; orb 40 → high; orb 15 → medium; similarity 0.6/margin 0.05 → medium; similarity 0.4 → low; orb 3 with similarity 0.9/margin 0.3 → medium not high).
- [ ] **Step 2: Run to see it fail** — `npx vitest run src/features/recognition/embedding`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the four modules.
- [ ] **Step 4: Run unit suite, lint, typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(recognition): pure core for embedding ranking, voting and confidence`.

---

### Task 2: Cover endpoint and cover-fetch refactor

**Files:** Create `src/app/api/covers/[gameId]/route.ts`, `src/features/recognition/cover-fetch.ts` (+ tests), `tests/e2e/app-covers.spec.ts` (small, normal project); Modify `cover-hash.ts` (re-exports until Task 7), `proxy.ts` only if `/api` needs excluding from i18n (it already is) — confirm Clerk's `auth()` works for the route.

**Interfaces:**
- `cover-fetch.ts` (`server-only`): `isAllowedCoverUrl`, `fetchCoverBytes` (moved unchanged from `cover-hash.ts`, tests move with them) and `coverJpeg(bytes: Uint8Array): Promise<Uint8Array | null>` — sharp: rotate by EXIF, flatten over white, resize inside 512×512 without enlargement, JPEG q85; `limitInputPixels` 25 MP; null on undecodable/SVG-like input.
- `GET /api/covers/[gameId]`: 401 when signed out; 404 for a non-uuid id, a game the caller cannot see (RLS: select from `games` as the user), no `cover_url`, or a blocked host; 502 when the fetch fails; 200 `image/jpeg` with `Cache-Control: private, max-age=604800` and `X-Content-Type-Options: nosniff` otherwise. Errors never echo the URL.

- [ ] **Step 1: Write the tests first**: unit tests for `coverJpeg` (a 3000×2000 PNG → ≤ 512 on the long side, JPEG, EXIF-rotated input upright, transparent PNG over white, a 30 MP bomb → null, SVG → null, corrupt → null); a route test with injected data access (extract the route's logic into `handleCoverRequest(gameId, deps)`): bad uuid → 404, no session → 401, not visible → 404 (same body as missing), no cover → 404, host not allowed → 404, fetch failed → 502, success → 200 JPEG with the cache headers. E2E (`app-covers.spec.ts`, user `o`): signed-in fetch of a fixture game's cover is not possible without network, so assert **behaviour with a stubbed upstream is covered in the unit test**, and E2E asserts only: anonymous request → 401, another user's private custom game → 404 identical to a random uuid, malformed id → 404.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement** (read the Next 16 route-handler docs first), keep `cover-hash.ts` working by re-exporting from `cover-fetch.ts`.
- [ ] **Step 4: Run unit suite, lint, typecheck, the new E2E.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(recognition): cover endpoint and shared cover fetching`.

---

### Task 3: Model hosting and the CLIP worker

**Files:** Create `scripts/copy-model-assets.mjs`, `src/features/recognition/embedding/{model.ts,embed.worker.ts,activation.ts}` (+ tests for the pure parts); Modify `package.json` (`@huggingface/transformers`, `fake-indexeddb` as devDependency later; `predev`/`prebuild` also run the copy script), `.gitignore`, `eslint.config.mjs`, `.prettierignore`, `next.config.ts`/`src/lib/security-headers.ts` (CSP `connect-src` for the model host when it is not same-origin), `docs/SECURITY.md`.

**Interfaces:**
- `copy-model-assets.mjs` (idempotent, loud on missing source): copies/downloads `Xenova/clip-vit-base-patch32` (`config.json`, `preprocessor_config.json`, `onnx/vision_model_quantized.onnx`) into `public/models/clip-vit-base-patch32/`, the ONNX Runtime Web `.wasm`/`.mjs` files that Transformers.js needs into `public/ort/`, and `@techstark/opencv-js`'s `opencv.js` into `public/opencv/`. Source for the model: the local Hugging Face cache if present, else a one-time download from huggingface.co at build time (the only time that host is used; never at run time).
- `model.ts` (browser-only): `modelConfig(): { base: string }` (same-origin `/models/` by default; `NEXT_PUBLIC_MODEL_BASE_URL` overrides, validated as https URL or a path); `createEmbedder(onProgress?: (p: { loaded: number; total: number }) => void): Promise<{ embed(image: ImageData): Promise<Vec>; dispose(): void }>` — spawns `embed.worker.ts` (module worker), which sets `env.allowLocalModels = true`, `env.allowRemoteModels = false`, `env.localModelPath`/`remoteHost` to our base, `env.useBrowserCache = true`, `env.backends.onnx.wasm.wasmPaths = "/ort/"`, `numThreads = 1`, loads `AutoProcessor` + `CLIPVisionModelWithProjection` (`dtype: "q8"`), and answers `{id, ImageData}` with `{id, vec}` (L2-normalized, length 512) or `{id, error}`; progress is relayed; `embed` rejects on worker error/timeout (30 s) and `dispose()` terminates the worker.
- Pure helper `frameToImageData(video: CanvasImageSource, w: number, h: number): ImageData` is tested with a fake canvas only if trivial; otherwise covered by E2E.
- `activation.ts` (browser): `isEnabled(): boolean` and `setEnabled(on: boolean): void` (the per-device flag in `localStorage`, every access in try/catch: unavailable storage means off); `modelStatus(): Promise<"installed" | "not-installed">` (Cache API check for the model files); `installModel(onProgress: (p: { loaded: number; total: number }) => void, signal?: AbortSignal): Promise<void>` — **the only function that downloads the model**: it loads CLIP once in the worker with downloads allowed, relays progress, and is all-or-nothing (on cancel or failure it deletes the partial cache entries and leaves the model not installed); `removeModel(): Promise<void>` (deletes the model cache); `ModelNotInstalledError`. `createEmbedder` calls `modelStatus()` first and throws `ModelNotInstalledError` when not installed, and loads with `local_files_only: true`, so it can never trigger a download.

- [ ] **Step 1: Write the tests first**: activation: the flag reads/writes and a throwing `localStorage` means off; `createEmbedder` refuses with `ModelNotInstalledError` and makes **no fetch** when the model is not installed; `installModel` is the only path that fetches (spy), reports progress, and a cancel or a failed fetch leaves no partial cache entry (fake `caches`); `removeModel` empties the cache; unit tests for `modelConfig` (default `/models/`, a valid https override, rejects `javascript:`/`data:`/non-URL strings), for the worker protocol parser (message → result/error mapping, timeout, dispose terminates) with a fake `Worker`, and a **Node parity test** (`embedding/model-parity.test.ts`, skipped if the model files are missing): run the same CLIP via Transformers.js in Node on a fixture image and check the vector is length 512 with unit norm and that two different fixtures are less similar than an image with itself. E2E smoke (in Task 6) covers the browser path.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement**; read the Transformers.js and ONNX Runtime Web docs via Context7 (worker usage, `wasmPaths`, `numThreads`, cache); measure model load time and ms per frame in headless Chromium and write both in the ledger. **Decide production hosting** (Supabase Storage public bucket vs `public/`) from Vercel's deployment size limit (check its current documentation) and record a `Ruling:`; if Storage, add `scripts/upload-model.mts` (service role, `--yes` guard) and the CSP `connect-src` entry.
- [ ] **Step 4: Run unit suite, lint, typecheck, `npm run build`** (the copy script runs in `prebuild`). Expected: PASS; first-load JS contains none of the model code (inspect chunks as in 7a).
- [ ] **Step 5: Commit** — `feat(recognition): self-hosted CLIP embedder in a Web Worker`.

---

### Task 4: Reference store and builder

**Files:** Create `src/features/recognition/embedding/{reference-store.ts,build-references.ts}` (+ tests); add `fake-indexeddb` (devDependency).

**Interfaces:**
- `reference-store.ts` (browser): `openReferenceStore(): Promise<ReferenceStore>` with `ReferenceStore { all(): Promise<Reference[]>; getCover(gameId): Promise<{ vec: Vec; coverUrl: string } | undefined>; putCover(gameId, coverUrl, vec): Promise<void>; addLearned(gameId, vec): Promise<void> /* keeps at most 3 per game, oldest dropped */; remove(gameId): Promise<void>; clear(): Promise<void> }`; DB name `amika-recognition`, versioned; if IndexedDB is unavailable or throws (private mode, quota), returns an **in-memory** store with the same interface and `persistent: false`.
- `build-references.ts`: `buildReferences(opts: { games: { id: string; coverUrl: string | null }[]; store: ReferenceStore; embedCover(gameId: string): Promise<Vec>; onProgress?(done: number, total: number): void; signal?: AbortSignal }): Promise<{ built: number; skipped: number; failed: string[] }>` — skips games without a cover or whose stored `coverUrl` is unchanged, processes one at a time, never throws for a single failure (collects the id in `failed`), stops promptly on abort, removes references of games no longer in `games`.

- [ ] **Step 1: Write the tests first** (with `fake-indexeddb`): put/get/all round-trip keeps Float32 values; `addLearned` keeps 3 newest; `remove`/`clear`; a second store instance sees persisted data; a broken IndexedDB (stub that throws on open) falls back to in-memory with `persistent: false`; `buildReferences`: embeds only new/changed covers (counts calls), reports progress 1..N, one failing cover is collected and the rest continue, abort mid-way stops before the next game and leaves already built ones stored, games removed from the catalog are purged, a game with `coverUrl: null` is skipped, a changed `coverUrl` re-embeds, 50 games complete with a stub embedder in < 1 s.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run unit suite, lint, typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(recognition): reference store and builder`.

---

### Task 5: OpenCV.js verifier and calibration

**Files:** Create `src/features/recognition/verify/{orb.ts,orb.test.ts}`; Rewrite `scripts/eval-recognition.mts` for the new pipeline; Modify `embedding/thresholds.ts`.

**Interfaces:**
- `orb.ts` (browser; `loadOpenCv(): Promise<Cv>` injects `/opencv/opencv.js` once as a classic script and resolves when `cv.Mat` exists, rejecting on timeout/blocked script; `verifyOrb(cv: Cv, frame: ImageData, cover: ImageData, opts?: { features?: number; ratio?: number; reprojection?: number }): number`): grayscale both to ≤ 640 px, ORB (default 1500 features), brute-force Hamming kNN k=2 with ratio 0.75, RANSAC homography (reprojection 5 px), returns the **inlier count** (0 when fewer than 8 good matches or no homography); **deletes every `Mat`/`KeyPointVector`/matcher in `finally`** (no leaks).
- The eval harness (`npm run recognition:eval -- <folder> --labels <file>`, Node: Transformers.js + `@techstark/opencv-js` + sharp, SAME pure code as the app) reports, over the user's photos against the catalog covers (and optionally `--distractors <folder>` of extra cover JPEGs): CLIP top-1/top-3, ORB verification of the CLIP top-3, final confidence level per photo, and **any photo whose "high" answer is wrong**.

- [ ] **Step 1: Write the tests first**: with `@techstark/opencv-js` in Node and sharp: a textured synthetic image vs the same image scaled 0.6×, rotated 20°, brightened and slightly blurred → inliers ≥ 40; vs an unrelated texture → ≤ 10; vs flat white → 0 (no throw); a call 100 times does not grow `cv` memory beyond a bound (sample `cv.Mat` creation/deletion counters via a wrapper, or run twice and assert the second run's allocations are all deleted); `loadOpenCv` rejects when the script is missing (fake document).
- [ ] **Step 2: Run to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement** `orb.ts` and rewrite the harness; keep `--self-test` (synthetic images, no DB).
- [ ] **Step 4: Calibrate**: run the harness on the user's 15 photos with `labels.resolved.json` and the 65-cover set (re-download distractors with the Task 5 helper if the scratch set is gone) and set the constants in `thresholds.ts` so that **top-1 ≥ 12/15** and **no wrong "high"**; record the table in the ledger and in ADR-037. If CLIP top-1 < 12/15, stop and report before continuing.
- [ ] **Step 5: Run unit suite, lint, typecheck, commit** — `feat(recognition): OpenCV.js ORB verifier and calibrated thresholds`.

---

### Task 6: Live camera UI and E2E

**Files:** Create `src/features/recognition/live/{frames.ts,use-live-recognition.ts}`, `src/features/recognition/components/{live-recognition.tsx,recognition-activation.tsx,recognition-settings.tsx}`, `tests/support/y4m.ts`, `tests/e2e/app-live-recognition.spec.ts`; Modify the games list page and the Settings page (a "Camera recognition" section) (replace `<IdentifyGame />`), messages en/es/fr (`Recognition.live.*`), `tests/e2e/helpers.ts`, `tests/e2e/auth.setup.ts`, `playwright.config.ts` (HEAVY), `src/lib/security-headers.ts` if a new origin is needed.

**Interfaces:**
- `use-live-recognition.ts`: a hook owning the whole session: `start()`, `stop()`, state `{ phase: "idle" | "loading-model" | "building-references" | "scanning" | "locked" | "error"; progress; lock?: { gameId; name; level; similarity; margin; orbInliers?; gtin? }; candidates: top 3; fps/ms; error?: "denied" | "no_camera" | "insecure" | "no_wasm" | "model_failed" | "timeout" }`; it requests the camera (`facingMode: "environment"`), loads the embedder and references lazily, grabs a frame every 500 ms **only when idle**, embeds, ranks, feeds the voter, reads the barcode about once a second, verifies the top candidates with ORB when the lock is not already high, auto-stops after 90 s without a lock and when the page is hidden, and always stops all tracks and disposes worker/OpenCV on exit.
- **Opt-in states** (before everything else): the games page renders `recognition-activation.tsx` while `isEnabled()` is false (or the model is not installed): a card "Recognize games with the camera" with an **Enable** button; Enable opens a confirmation that says what it is and warns "About 85 MB will be downloaded once (Wi-Fi recommended) and stored on this device" with **Download and enable** / **Not now**; only "Download and enable" calls `installModel` (progress bar, **Cancel**, error + **Retry**); on success it builds the references (progress) and then sets the flag and shows the live camera section. `recognition-settings.tsx` shows the status (not enabled / downloading / ready, installed size) and **Disable and delete data** (`removeModel`, `store.clear()`, flag off). The hook never starts the camera or the embedder while disabled.
- `live-recognition.tsx`: region "Recognize with the camera" containing a Start/Stop button, a `<video muted playsInline>` preview, a `role="status"` line (phase text), a progress bar for the one-time model download and for building references (with a size warning before the first download), the "Looks like X" card with confidence word, the 2 runner-ups, **"This is it"** (opens the game; saves the frame vector via `store.addLearned` and learns the barcode through the existing actions) and **"Not this one"** (resets the voter and excludes that game for the session), a "choose a photo instead" file input reusing the same embedder, and the always-visible privacy line "The camera image stays on your device."
- `tests/support/y4m.ts`: writes a YUV4MPEG2 file from an image (sharp → I420) so Chromium's `--use-file-for-media-stream` can play it; E2E launches Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-media-stream=<file>` in the `app-heavy` project.

- [ ] **Step 1: Write the E2E spec first**, starting with the opt-in: a fresh profile shows only the Enable card and the page makes **no** `/models/`, `/ort/` or `/opencv/` request and starts no worker; pressing Enable shows the message with "85 MB" **before any model request** (assert order from the request log); "Not now" leaves the feature off with zero requests; "Download and enable" shows progress, then the reference build, then the camera section; after a reload it is still enabled and the model is not downloaded again; Settings shows the status and **Disable and delete data** returns to the Enable card and empties Cache Storage and IndexedDB; an aborted download (`page.route` abort) shows an error with Retry and the feature stays off; Cancel during the download leaves no partial cache. Then the live-camera tests below, which run with the feature already enabled (user `o`, prefix `9909`; fixture games inserted with real cover images served from the test, vectors built through the real cover endpoint is NOT possible offline, so the spec **seeds the IndexedDB references itself** by running the real embedder in the page on fixture images through a test-only hook is NOT allowed either: instead the spec serves the fixture covers from a `page.route("**/api/covers/*")` handler that fulfils with the fixture JPEGs, so the app's real builder runs end to end): the camera showing the Wingspan fixture locks "Looks like Wingspan" and the confidence is shown; the camera showing a different fixture locks the other game; a blank/dark feed never locks and says so after a while; two near-identical fixtures (ambiguous) do not lock; "This is it" opens the game and stores a learned vector (assert via the page's IndexedDB); "Not this one" excludes the game for the session; permission denied (launch without the fake-UI flag in a second project/context with permissions denied) shows its message; no camera (`getUserMedia` stubbed to reject `NotFoundError`) shows its message; `WebAssembly` removed shows its message; stop/leave releases the camera (every track `readyState === "ended"`) and terminates the worker; **privacy**: all requests during the session — none carries image bytes (no `multipart`, no `image/*` request bodies, bodies < 2 KB), none leaves for a third-party host, model/engine requests go to our origin only and only after clicking Start; first-load JS contains no `/models/`, `/ort/` or `/opencv/` strings; the second session reuses the cache (no model re-download); axe light/dark on idle and locked states; 375 px: no sideways scroll and buttons ≥ 44 px; es/fr labels.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL (no region).
- [ ] **Step 3: Implement** hook, component, page wiring, messages; read the Next 16 docs for client/server boundaries and worker bundling.
- [ ] **Step 4: Run lint, typecheck, unit, the new E2E, then the full E2E suite.** Expected: PASS (retried flakes listed in the ledger).
- [ ] **Step 5: Commit** — `feat(recognition): live camera recognition`.

---

### Task 7: Retire OCR and image hashes

**Files:** Delete `src/features/recognition/browser/{ocr.ts,ocr.test.ts,pipeline.ts,pipeline.test.ts}` (keep `barcode.ts`, `image-prep.ts` only if still used by the photo flow; delete the hash parts of `image-prep`), `dhash.ts` + tests, `hash-bytes.ts`, `cover-hash.ts` (+ tests; the fetch tests already moved), `components/identify-game.tsx`, `merge.ts` signals for `image` if unused, `identify.ts` image/title paths **only where the new flow no longer uses them** (keep title search and BGG text search as the manual fallback if the UI still calls them), `scripts/backfill-cover-hashes.mts`, `scripts/copy-ocr-assets.mjs`, `tests/e2e/app-recognition.spec.ts` (replaced by Task 6), `tests/integration/rls-recognition.test.ts` hash sections; Modify `import-service.ts` (remove the hash hook and `ImportStore.saveCoverHash`), `package.json` (remove `tesseract.js`, `@tesseract.js-data/*`; keep `zxing-wasm`, `sharp`, `tsx`), `.gitignore`/ignores for `public/tesseract`, `next.config.ts`/`proxy.ts` (`tesseract/` exclusion), messages (`Recognition.*` keys no longer used), `docs/*`; Create `supabase/migrations/20261116200000_drop_image_hashes.sql`.

**Interfaces:** the migration drops `public.match_game_images(text,int,int)`, `public.save_photo_hash(uuid,text)`, `public.upsert_cover_hash(uuid,text)`, `public.hex_to_hash(text)`, the trigger/function `enforce_image_hash_cap`, and table `public.game_image_hashes` (policies drop with it); `game_barcodes` and its cap function stay. Regenerate `src/lib/supabase/database.types.ts`.

- [ ] **Step 1: Write the tests first**: update `rls-recognition.test.ts` so the barcode tests stay and the hash tests are replaced by "the dropped objects no longer exist" assertions (`to_regclass`/`to_regprocedure` are null); an import unit test proving `importExternalGame` no longer touches `saveCoverHash` (the store type has no such method); a grep-style unit test (`tests/unit/no-dead-code.test.ts` reading the file tree) that fails if any of `tesseract`, `dhash`, `game_image_hashes`, `match_game_images` appears under `src/` or `scripts/` outside the migration files and the ADRs.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL (code still present).
- [ ] **Step 3: Remove the code, assets, dependencies; write the migration; rehearse it in a rolled-back transaction; ask the user before `db push`; apply; regenerate types.**
- [ ] **Step 4: Run lint, typecheck, unit, integration, `npm run build`, the full E2E suite.** Expected: PASS.
- [ ] **Step 5: Commit** — `refactor(recognition): retire OCR and image hashes`.

---

### Task 8: Docs and final verification

**Files:** `docs/ROADMAP.md` (status table 7a-2: results of the calibration, phone performance still unmeasured), `docs/DATABASE.md` (§ recognition: hash objects removed), `docs/SECURITY.md` (§ live camera: privacy rule, cover endpoint, CSP), `docs/DECISIONS.md` (ADR-037: CLIP + ORB, retirement of OCR/hash, hosting ruling, licences).

- [ ] **Step 1:** Write the docs with the real numbers from the ledger (model load time, ms per frame, calibration table, dependency sizes, asset sizes).
- [ ] **Step 2: Run the full verification** (`npm test`, lint, typecheck, `npm run build`, integration, full E2E). Expected: all PASS.
- [ ] **Step 3: Ask the user to try it** on their phone against the deployed or tunnelled app (the phone performance is the one thing unmeasured here) and record what they see.
- [ ] **Step 4: Commit** — `docs: Phase 7a-2`.
