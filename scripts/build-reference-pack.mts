/**
 * Builds the reference pack of the live camera recognition (Phase 7a-3): the CLIP vectors of
 * the covers of BoardGameGeek's top N games, so the phone can recognize a box even when the
 * game is not in the user's catalog.
 *
 *   npm run recognition:pack -- <boardgames_ranks.csv> [--count 500] [--delay 1500] [--cache <dir>]
 *   npm run recognition:pack -- --self-test        # no network, no model
 *
 * Needs BGG_API_TOKEN in .env.local (BGG's API gives the full cover URLs; the CSV only has
 * 64 px thumbnails) and the model (node scripts/copy-model-assets.mjs). Sequential and
 * resumable: answers and covers are cached in --cache, so an interrupted run continues.
 * Writes src/features/recognition/pack/pack-manifest.json and
 * public/reference-pack/vectors-<hash8>.bin (both committed).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BggError } from "../src/features/catalog/sources/bgg/errors.ts";
import { createBggSource } from "../src/features/catalog/sources/bgg/client.ts";
import {
  coverJpeg,
  fetchCoverBytes,
} from "../src/features/recognition/cover-fetch.ts";
import { normalize } from "../src/features/recognition/embedding/rank.ts";
import { EMBED_DIM } from "../src/features/recognition/embedding/thresholds.ts";
import {
  buildPack,
  type PackEntry,
} from "../src/features/recognition/pack/build-pack.ts";
import { parseRanksCsv } from "../src/features/recognition/pack/csv.ts";
import { decodePack } from "../src/features/recognition/pack/format.ts";
import { decode, loadEmbedder } from "./lib/clip-node.mts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MANIFEST_PATH = join(
  "src",
  "features",
  "recognition",
  "pack",
  "pack-manifest.json",
);
const VECTORS_DIR = join("public", "reference-pack");

/** Writes the two files; removes older vectors files so only the current one ships. */
function writePack(
  built: ReturnType<typeof buildPack>,
  manifestPath: string,
  vectorsDir: string,
) {
  mkdirSync(vectorsDir, { recursive: true });
  for (const f of readdirSync(vectorsDir))
    if (/^vectors-[0-9a-f]{8}\.bin$/.test(f)) rmSync(join(vectorsDir, f));
  writeFileSync(join(vectorsDir, built.manifest.vectors), built.bytes);
  writeFileSync(manifestPath, JSON.stringify(built.manifest, null, 2) + "\n");
}

function runSelfTest() {
  const entries: PackEntry[] = [1, 2, 3].map((rank) => {
    const v = new Array(EMBED_DIM).fill(0);
    v[rank] = 1;
    return {
      row: {
        bggId: String(rank),
        name: `Synthetic ${rank}`,
        year: 2000,
        rank,
      },
      coverUrl: `https://cf.geekdo-images.com/s${rank}.jpg`,
      vec: normalize(v),
    };
  });
  const built = buildPack(entries);
  const dir = join(tmpdir(), `amika-pack-selftest-${Date.now()}`);
  writePack(
    built,
    join(mkdirSync(dir, { recursive: true }) ?? dir, "m.json"),
    dir,
  );
  const bytes = readFileSync(join(dir, built.manifest.vectors));
  const vecs = decodePack(new Uint8Array(bytes), 3);
  const ok = vecs.every((v, i) => Math.abs(v[i + 1] - 1) < 1e-6);
  rmSync(dir, { recursive: true, force: true });
  console.log(
    ok ? `self-test OK (${built.manifest.vectors})` : "self-test FAILED",
  );
  process.exit(ok ? 0 : 1);
}

type Details = Record<string, string | null>; // bggId -> full cover URL, null = none

async function main() {
  if (args.includes("--self-test")) return runSelfTest();

  const csvPath = args.find(
    (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
  );
  if (!csvPath || !existsSync(csvPath)) {
    console.error(
      "Usage: npm run recognition:pack -- <boardgames_ranks.csv> [--count 500] [--delay 1500] [--cache <dir>]",
    );
    process.exit(2);
  }
  const token = process.env.BGG_API_TOKEN;
  if (!token) {
    console.error("Needs BGG_API_TOKEN in .env.local.");
    process.exit(2);
  }
  const count = Number(flag("--count") ?? 500);
  const delay = Number(flag("--delay") ?? 1500);
  const cacheDir = flag("--cache") ?? join(tmpdir(), "amika-pack-cache");
  mkdirSync(join(cacheDir, "covers"), { recursive: true });

  const rows = parseRanksCsv(readFileSync(csvPath, "utf8"), count);
  console.log(`${rows.length} games ranked 1..${count} in the CSV`);

  // 1. full cover URLs from BGG's API (sequential, throttled, resumable)
  const detailsFile = join(cacheDir, "details.json");
  const details: Details = existsSync(detailsFile)
    ? JSON.parse(readFileSync(detailsFile, "utf8"))
    : {};
  const bgg = createBggSource({ token });
  let calls = 0;
  for (const row of rows) {
    if (row.bggId in details) continue;
    for (let attempt = 0; ; attempt++) {
      try {
        details[row.bggId] = (await bgg.fetchGame(row.bggId)).coverUrl;
        break;
      } catch (error) {
        const wait = error instanceof BggError && error.code === "rate_limited";
        if (wait && attempt < 3) {
          console.log(`rate limited, waiting 30 s (${row.name})`);
          await sleep(30_000);
          continue;
        }
        console.log(
          `no details for ${row.bggId} ${row.name}: ${(error as Error).message}`,
        );
        break; // left out of `details`: retried on the next run
      }
    }
    writeFileSync(detailsFile, JSON.stringify(details));
    if (++calls % 25 === 0)
      console.log(`  details ${Object.keys(details).length}/${rows.length}`);
    await sleep(delay);
  }

  // 2. covers (through the app's guarded fetch) and 3. their vectors
  const embed = await loadEmbedder();
  const entries: PackEntry[] = [];
  let done = 0;
  for (const row of rows) {
    const coverUrl = details[row.bggId] ?? null;
    let vec: Float32Array | null = null;
    if (coverUrl) {
      const cached = join(cacheDir, "covers", `${row.bggId}.jpg`);
      let jpeg: Uint8Array | null = existsSync(cached)
        ? readFileSync(cached)
        : null;
      if (!jpeg) {
        const bytes = await fetchCoverBytes(coverUrl, fetch, {
          maxBytes: 16 * 1024 * 1024, // a few PNG originals are 5-6 MB (the app's cap is 5 MB)
          timeoutMs: 30_000,
        });
        // Some BGG originals are 27-32 MP: this offline script may decode more than the app's limit.
        jpeg = bytes
          ? await coverJpeg(bytes, { maxInputPixels: 64_000_000 })
          : null;
        if (jpeg) writeFileSync(cached, jpeg);
      }
      if (jpeg) vec = await embed(await decode(jpeg, 512));
    }
    entries.push({ row, coverUrl, vec });
    if (++done % 50 === 0) console.log(`  vectors ${done}/${rows.length}`);
  }

  // 4. the two files
  const built = buildPack(entries);
  writePack(built, MANIFEST_PATH, VECTORS_DIR);
  console.log(
    `pack written: ${built.manifest.games.length} games, ${built.bytes.byteLength} bytes, ${built.manifest.vectors}`,
  );
  if (built.skipped.length) {
    console.log(`skipped ${built.skipped.length}:`);
    for (const s of built.skipped)
      console.log(`  ${s.bggId} ${s.name} (${s.reason})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
