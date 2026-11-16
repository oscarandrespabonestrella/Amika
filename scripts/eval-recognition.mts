/**
 * Measures the live recognition pipeline on real photos, with the SAME code the app runs:
 * CLIP vectors (the model in public/models), cosine ranking, ORB verification
 * (OpenCV.js) and the confidence levels of embedding/confidence.ts. Not part of CI.
 *
 *   npm run recognition:eval -- <folder> [--labels <file>] [--distractors <folder>]
 *   npm run recognition:eval -- --self-test        # no photos, no database
 *
 * <folder> holds the photos (jpg, png, webp) and a labels.json mapping each file name to
 * the expected game: its catalog id (uuid) or its exact catalog name. The references are
 * the covers of the dev catalog (fetched through the same guarded code as the app);
 * --distractors adds more cover JPEGs (named <bggId>.jpg; those of games already in the
 * catalog are skipped) to resemble a bigger catalog. Keep your photos OUTSIDE the repo.
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
import {
  levelFor,
  type Level,
} from "../src/features/recognition/embedding/confidence.ts";
import {
  normalize,
  rankByCosine,
  type Reference,
} from "../src/features/recognition/embedding/rank.ts";
import { pickVerified } from "../src/features/recognition/embedding/resolve.ts";
import {
  LOCK_MIN_MARGIN,
  LOCK_MIN_SIMILARITY,
} from "../src/features/recognition/embedding/thresholds.ts";
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
const distractorsDir = flag("--distractors");
const folder = args.find(
  (a) => !a.startsWith("--") && a !== labelsFlag && a !== distractorsDir,
);

const MODELS = join(process.cwd(), "public", "models");
const FRAME_SIDE = 1280; // the browser sends camera frames of about this size

// --- engines ------------------------------------------------------------------------

const require = createRequire(import.meta.url);

async function loadCv(): Promise<Cv> {
  const candidate = require("@techstark/opencv-js");
  const cv = candidate instanceof Promise ? await candidate : candidate;
  if (!cv.Mat) await new Promise<void>((r) => (cv.onRuntimeInitialized = r));
  return cv as Cv;
}

async function loadEmbedder() {
  if (
    !existsSync(
      join(
        MODELS,
        "clip-vit-base-patch32",
        "onnx",
        "vision_model_quantized.onnx",
      ),
    )
  )
    throw new Error("model missing: run node scripts/copy-model-assets.mjs");
  const { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } =
    await import("@huggingface/transformers");
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = MODELS + "/";
  const processor = await AutoProcessor.from_pretrained(
    "clip-vit-base-patch32",
  );
  const model = await CLIPVisionModelWithProjection.from_pretrained(
    "clip-vit-base-patch32",
    { dtype: "q8" },
  );
  return async (image: RgbaImage) => {
    const raw = new RawImage(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height,
      4,
    ).rgb();
    const { image_embeds } = await model(await processor(raw));
    return normalize(Array.from(image_embeds.data as ArrayLike<number>));
  };
}

/** Decoded RGBA at the size the browser would send (EXIF applied, long side <= 1280). */
async function decode(
  input: Buffer | Uint8Array,
  side = FRAME_SIDE,
): Promise<RgbaImage> {
  const { data, info } = await sharp(Buffer.from(input))
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: side,
      height: side,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  };
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
  console.log(
    `references: ${refs.length - extra} catalog covers + ${extra} distractors`,
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
    const ranked = rankByCosine(await embed(photo), refs);
    const top = ranked[0];
    const margin = ranked[1] ? top.score - ranked[1].score : 1;

    // The live pipeline's decision, for one frame: ORB re-ranks the CLIP top 3 (decisive
    // when strong), otherwise CLIP alone must clear the lock thresholds.
    const orb = new Map<string, number>();
    for (const r of ranked.slice(0, 3))
      orb.set(r.gameId, verifyOrb(cv, photo, coverImages.get(r.gameId)!));
    const verified = pickVerified(orb);
    const locked =
      top.score >= LOCK_MIN_SIMILARITY && margin >= LOCK_MIN_MARGIN;
    const answerId = verified?.gameId ?? (locked ? top.gameId : null);
    const answer = answerId ? ranked.find((r) => r.gameId === answerId)! : null;
    const level = answer
      ? levelFor({
          similarity: answer.score,
          margin: answer.gameId === top.gameId ? margin : 0,
          orbInliers: orb.get(answer.gameId) ?? 0,
        })
      : null;
    const outcome: Row["outcome"] = !answer
      ? "not sure"
      : answer.gameId === truth
        ? "RECOGNIZED"
        : "WRONG";
    const rank = ranked.findIndex((r) => r.gameId === truth) + 1 || null;
    rows.push({
      file,
      rank,
      outcome,
      level,
      clipTop1Right: top.gameId === truth,
      ms: Date.now() - started,
    });
    console.log(
      `${file.padEnd(7)} ${outcome.padEnd(10)} ${level ? "(" + level + ")" : ""}`.padEnd(
        34,
      ) +
        `| clip rank ${String(rank ?? "-").padStart(2)} sim ${top.score.toFixed(3)} lead ${margin.toFixed(3)} | orb top3 ${[...orb.entries()].map(([g, n]) => (g === truth ? "*" : "") + n).join("/")}${
          answer && answer.gameId !== truth
            ? ` | said "${names.get(answer.gameId)}"`
            : ""
        }`,
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
    `\n=== ${n} labeled photos against ${refs.length} references ===`,
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
  const pass = wrongConfident.length === 0 && recognized.length >= 10;
  console.log(
    `GATE (no wrong answer at high/medium AND >= 10 recognized): ${pass ? "PASS" : "FAIL"}`,
  );
}

await main();
