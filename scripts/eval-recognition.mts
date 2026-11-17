/**
 * Measures the live recognition pipeline on real photos, with the SAME code the app runs:
 * CLIP vectors (the model in public/models), cosine ranking, ORB verification
 * (OpenCV.js) and the confidence levels of embedding/confidence.ts. Not part of CI.
 *
 *   npm run recognition:eval -- <folder> [--labels <file>] [--distractors <folder>] [--pack]
 *   npm run recognition:eval -- --self-test        # no photos, no database
 *
 * <folder> holds the photos (jpg, png, webp) and a labels.json mapping each file name to
 * the expected game: its catalog id (uuid) or its exact catalog name. The references are
 * the covers of the dev catalog (fetched through the same guarded code as the app);
 * --distractors adds more cover JPEGs (named <bggId>.jpg; those of games already in the
 * catalog are skipped) to resemble a bigger catalog. --pack adds the committed reference pack
 * (BoardGameGeek's top 500) the way the app does (a catalog game hides its pack entry) and also
 * runs an "unknown box" check per photo: the same photo with its own game REMOVED from the
 * references must never be answered at high or medium (it must end "not sure" or low). Keep your photos OUTSIDE the repo.
 * Needs the model (scripts/copy-model-assets.mjs), SUPABASE_DB_PASSWORD (.env.local) and
 * `supabase link`. BoardGameGeek is only used to download covers.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import {
  coverJpeg,
  fetchCoverBytes,
} from "../src/features/recognition/cover-fetch.ts";
import { type Level } from "../src/features/recognition/embedding/confidence.ts";
import {
  rankByCosine,
  type Reference,
} from "../src/features/recognition/embedding/rank.ts";
import {
  decide,
  singleFrameLock,
} from "../src/features/recognition/embedding/resolve.ts";
import { decode, loadEmbedder, MODELS } from "./lib/clip-node.mts";
import { decodePack } from "../src/features/recognition/pack/format.ts";
import { getPackManifest } from "../src/features/recognition/pack/manifest.ts";
import { assembleReferences } from "../src/features/recognition/pack/merge.ts";
import {
  verifyOrb,
  type Cv,
  type RgbaImage,
} from "../src/features/recognition/verify/orb.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const selfTest = args.includes("--self-test");
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const labelsFlag = flag("--labels");
const usePack = args.includes("--pack");
const distractorsDir = flag("--distractors");
const folder = args.find(
  (a) => !a.startsWith("--") && a !== labelsFlag && a !== distractorsDir,
);

// --- engines ------------------------------------------------------------------------

const require = createRequire(import.meta.url);

async function loadCv(): Promise<Cv> {
  const candidate = require("@techstark/opencv-js");
  const cv = candidate instanceof Promise ? await candidate : candidate;
  if (!cv.Mat) await new Promise<void>((r) => (cv.onRuntimeInitialized = r));
  return cv as Cv;
}

// --- self test ----------------------------------------------------------------------

async function runSelfTest() {
  // A feature-rich synthetic picture: random coloured blocks of several sizes.
  const size = 480;
  const raw = Buffer.alloc(size * size * 3);
  let seed = 7;
  const rand = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const block of [64, 32, 16]) {
    const cols = Math.ceil(size / block);
    const tones = Array.from({ length: cols * cols }, () => [
      rand() * 255,
      rand() * 255,
      rand() * 255,
    ]);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const idx = Math.floor(y / block) * cols + Math.floor(x / block);
        if (idx % 3 === (block / 16) % 3) {
          const o = (y * size + x) * 3;
          raw[o] = tones[idx][0];
          raw[o + 1] = tones[idx][1];
          raw[o + 2] = tones[idx][2];
        }
      }
  }
  const png = await sharp(raw, {
    raw: { width: size, height: size, channels: 3 },
  })
    .png()
    .toBuffer();
  const cv = await loadCv();
  const a = await decode(png);
  const b = await decode(
    await sharp(png)
      .rotate(15, { background: "#808080" })
      .resize(320)
      .toBuffer(),
  );
  const inliers = verifyOrb(cv, b, a);
  let ok = inliers > 20;
  console.log(
    `self-test ORB: ${inliers} inliers for the same picture rotated and scaled (expected > 20)`,
  );
  if (
    existsSync(
      join(
        MODELS,
        "clip-vit-base-patch32",
        "onnx",
        "vision_model_quantized.onnx",
      ),
    )
  ) {
    const embed = await loadEmbedder();
    const va = await embed(a);
    const vb = await embed(b);
    const sim = va.reduce((sum, x, i) => sum + x * vb[i], 0);
    console.log(
      `self-test CLIP: dim ${va.length}, similarity ${sim.toFixed(3)} (expected > 0.8)`,
    );
    ok &&= va.length === 512 && sim > 0.8;
  } else console.log("self-test CLIP: skipped (model not in public/models)");
  console.log(ok ? "self-test OK" : "self-test FAILED");
  process.exit(ok ? 0 : 1);
}

// --- evaluation ---------------------------------------------------------------------

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  file: string;
  rank: number | null;
  outcome: "RECOGNIZED" | "not sure" | "WRONG";
  level: Level | null;
  clipTop1Right: boolean;
  ms: number;
  /** --pack: the same photo with its own game removed from the references. */
  unknown?: {
    said: string | null;
    level: Level | null;
    similarity: number | null;
    margin: number | null;
    orbInliers: number | null;
  };
};

async function main() {
  if (selfTest) return runSelfTest();
  const labelsPath = labelsFlag ?? (folder ? join(folder, "labels.json") : "");
  if (!folder || !existsSync(labelsPath)) {
    console.error(
      "Usage: npm run recognition:eval -- <folder> [--labels <file>] [--distractors <folder>]",
    );
    process.exit(2);
  }
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password || !existsSync("supabase/.temp/pooler-url")) {
    console.error(
      "Needs SUPABASE_DB_PASSWORD in .env.local and `supabase link`.",
    );
    process.exit(2);
  }
  const url = new URL(readFileSync("supabase/.temp/pooler-url", "utf8").trim());
  url.password = password;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();

  const catalog = (
    await db.query<{
      id: string;
      name: string;
      cover_url: string | null;
      bgg: string | null;
    }>(
      `select g.id, g.name, g.cover_url,
              (select e.external_id from public.game_external_ids e
                where e.game_id = g.id and e.source = 'bgg' limit 1) as bgg
         from public.games g`,
    )
  ).rows;
  await db.end();
  const labels: Record<string, string> = JSON.parse(
    readFileSync(labelsPath, "utf8"),
  );
  const idOf = (label: string) =>
    UUID.test(label)
      ? label.toLowerCase()
      : (catalog.find((g) => g.name.toLowerCase() === label.toLowerCase())
          ?.id ?? null);

  const [cv, embed] = await Promise.all([loadCv(), loadEmbedder()]);

  // references: catalog covers (through the app's guarded fetch) + optional distractors
  const cacheDir = join(tmpdir(), "amika-eval-covers");
  mkdirSync(cacheDir, { recursive: true });
  const refs: Reference[] = [];
  const coverImages = new Map<string, RgbaImage>();
  const names = new Map<string, string>();
  for (const game of catalog.filter((g) => g.cover_url)) {
    const cached = join(cacheDir, `${game.id}.jpg`);
    let jpeg: Uint8Array | null = existsSync(cached)
      ? readFileSync(cached)
      : null;
    if (!jpeg) {
      const bytes = await fetchCoverBytes(game.cover_url!);
      jpeg = bytes ? await coverJpeg(bytes) : null;
      if (jpeg) writeFileSync(cached, jpeg);
    }
    if (!jpeg) {
      console.log(`cover not available: ${game.name}`);
      continue;
    }
    const image = await decode(jpeg, 512);
    coverImages.set(game.id, image);
    names.set(game.id, game.name);
    refs.push({ gameId: game.id, vec: await embed(image), kind: "cover" });
  }
  const own = new Set(catalog.map((g) => g.bgg).filter(Boolean));
  let extra = 0;
  if (distractorsDir)
    for (const file of readdirSync(distractorsDir).filter((f) =>
      IMAGE_EXT.has(extname(f).toLowerCase()),
    )) {
      const base = file.replace(/\.[^.]+$/, "");
      if (own.has(base)) continue; // already a catalog game
      const image = await decode(readFileSync(join(distractorsDir, file)), 512);
      coverImages.set(`d:${base}`, image);
      names.set(`d:${base}`, `distractor ${base}`);
      refs.push({
        gameId: `d:${base}`,
        vec: await embed(image),
        kind: "cover",
      });
      extra++;
    }
  // The pack (BGG top 500): vectors from the committed files, covers for ORB on demand.
  const packCovers = new Map<string, { name: string; coverUrl: string }>();
  let packCount = 0;
  if (usePack) {
    const manifest = getPackManifest();
    const vecs = decodePack(
      new Uint8Array(
        readFileSync(join("public", "reference-pack", manifest.vectors)),
      ),
      manifest.games.length,
    );
    manifest.games.forEach((g, i) => {
      const id = `bgg:${g.bggId}`;
      refs.push({ gameId: id, vec: vecs[i], kind: "pack" });
      names.set(id, g.name);
      packCovers.set(id, { name: g.name, coverUrl: g.coverUrl });
    });
    packCount = manifest.games.length;
  }
  // Same rule as the app: a catalog game hides its own pack entry.
  const allRefs = usePack
    ? assembleReferences(
        refs,
        catalog.map((g) => ({ bggId: g.bgg })),
      )
    : refs;
  const packCoverImages = new Map<string, RgbaImage | null>();
  async function coverOf(gameId: string): Promise<RgbaImage | null> {
    const have = coverImages.get(gameId);
    if (have) return have;
    const info = packCovers.get(gameId);
    if (!info) return null;
    if (packCoverImages.has(gameId)) return packCoverImages.get(gameId)!;
    const cached = join(
      tmpdir(),
      "amika-pack-cache",
      "covers",
      `${gameId.slice(4)}.jpg`,
    );
    let jpeg: Uint8Array | null = existsSync(cached)
      ? readFileSync(cached)
      : null;
    if (!jpeg) {
      const bytes = await fetchCoverBytes(info.coverUrl);
      jpeg = bytes ? await coverJpeg(bytes) : null;
    }
    const image = jpeg ? await decode(jpeg, 512) : null;
    packCoverImages.set(gameId, image);
    return image;
  }
  console.log(
    `references: ${refs.length - extra - packCount} catalog covers + ${extra} distractors + ${packCount} pack games (${allRefs.length} used)`,
  );

  const rows: Row[] = [];
  const files = readdirSync(folder)
    .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const file of files) {
    const label = labels[file];
    const truth = label ? idOf(label) : null;
    if (!truth || !coverImages.has(truth)) {
      console.log(`${file}: skipped (no label, or no cover for its game)`);
      continue;
    }
    const started = Date.now();
    const photo = await decode(readFileSync(join(folder, file)));
    const photoVec = await embed(photo);
    const ranked = rankByCosine(photoVec, allRefs);
    const top = ranked[0];
    const margin = ranked[1] ? top.score - ranked[1].score : 1;

    // The live pipeline's decision, for one frame: ORB re-ranks the CLIP top 3 (decisive
    // when strong), otherwise CLIP alone must clear the lock thresholds.
    const orb = new Map<string, number>();
    for (const r of ranked.slice(0, 3)) {
      const cover = await coverOf(r.gameId);
      orb.set(r.gameId, cover ? verifyOrb(cv, photo, cover) : 0);
    }
    const decision = decide({ ranked, orb, lock: singleFrameLock(ranked) });
    const answer = decision
      ? ranked.find((r) => r.gameId === decision.gameId)!
      : null;
    const level = decision?.level ?? null;
    const outcome: Row["outcome"] = !answer
      ? "not sure"
      : answer.gameId === truth
        ? "RECOGNIZED"
        : "WRONG";
    const rank = ranked.findIndex((r) => r.gameId === truth) + 1 || null;
    // "Unknown box": the same photo, its own game (catalog entry AND pack entry) removed.
    let unknown: Row["unknown"];
    if (usePack) {
      const truthBgg = catalog.find((g) => g.id === truth)?.bgg;
      const without = allRefs.filter(
        (r) => r.gameId !== truth && r.gameId !== `bgg:${truthBgg}`,
      );
      const rankedU = rankByCosine(photoVec, without);
      const orbU = new Map<string, number>();
      for (const r of rankedU.slice(0, 3)) {
        const cover = await coverOf(r.gameId);
        orbU.set(r.gameId, cover ? verifyOrb(cv, photo, cover) : 0);
      }
      const decisionU = decide({
        ranked: rankedU,
        orb: orbU,
        lock: singleFrameLock(rankedU),
      });
      unknown = {
        said: decisionU
          ? (names.get(decisionU.gameId) ?? decisionU.gameId)
          : null,
        level: decisionU?.level ?? null,
        similarity: decisionU?.similarity ?? null,
        margin: decisionU?.margin ?? null,
        orbInliers: decisionU?.orbInliers ?? null,
      };
    }
    rows.push({
      file,
      rank,
      outcome,
      level,
      clipTop1Right: top.gameId === truth,
      ms: Date.now() - started,
      unknown,
    });
    console.log(
      `${file.padEnd(7)} ${outcome.padEnd(10)} ${level ? "(" + level + ")" : ""}`.padEnd(
        34,
      ) +
        `| clip rank ${String(rank ?? "-").padStart(2)} sim ${top.score.toFixed(3)} lead ${margin.toFixed(3)} | orb top3 ${[...orb.entries()].map(([g, n]) => (g === truth ? "*" : "") + n).join("/")}${
          answer && answer.gameId !== truth
            ? ` | said "${names.get(answer.gameId)}"`
            : ""
        }` +
        (unknown
          ? ` | unknown-box: ${unknown.said ? `said "${unknown.said}" (${unknown.level}, sim ${unknown.similarity?.toFixed(3)}, lead ${unknown.margin?.toFixed(3)}, orb ${unknown.orbInliers})` : "not sure"}`
          : ""),
    );
  }

  const n = rows.length;
  const recognized = rows.filter((r) => r.outcome === "RECOGNIZED");
  const wrong = rows.filter((r) => r.outcome === "WRONG");
  const wrongConfident = wrong.filter(
    (r) => r.level === "high" || r.level === "medium",
  );
  const clipTop1 = rows.filter((r) => r.clipTop1Right).length;
  const count = (l: Level) => rows.filter((r) => r.level === l).length;
  console.log(
    `\n=== ${n} labeled photos against ${allRefs.length} references ===`,
  );
  console.log(
    `RECOGNIZED ${recognized.length}/${n}   not sure ${rows.filter((r) => r.outcome === "not sure").length}/${n}   WRONG ${wrong.length}/${n}`,
  );
  console.log(
    `answers by level: high ${count("high")}, medium ${count("medium")}, low ${count("low")}   (raw CLIP top-1: ${clipTop1}/${n})`,
  );
  console.log(
    `wrong answers shown as high or medium: ${wrongConfident.length}${wrongConfident.length ? " -> " + wrongConfident.map((r) => r.file).join(", ") : ""}`,
  );
  console.log(
    `wrong answers shown as low: ${wrong.length - wrongConfident.length}`,
  );
  console.log(
    `mean time per photo: ${Math.round(rows.reduce((sum, r) => sum + r.ms, 0) / Math.max(1, n))} ms`,
  );
  const unknownConfident = rows.filter(
    (r) =>
      r.unknown && (r.unknown.level === "high" || r.unknown.level === "medium"),
  );
  if (usePack)
    console.log(
      `unknown-box check: ${rows.length - unknownConfident.length}/${n} ended not sure or low; confident answers on a box that is in NO reference: ${unknownConfident.length}${unknownConfident.length ? " -> " + unknownConfident.map((r) => r.file).join(", ") : ""}`,
    );
  const pass =
    wrongConfident.length === 0 &&
    unknownConfident.length === 0 &&
    recognized.length >= 10;
  console.log(
    `GATE (no wrong answer at high/medium, none on an unknown box, AND >= 10 recognized): ${pass ? "PASS" : "FAIL"}`,
  );
}

await main();
