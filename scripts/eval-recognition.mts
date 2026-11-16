/**
 * Measures how well the local recognition finds a game from a photo of its box, per
 * technique and combined, using the SAME code the app uses (barcode check digits, OCR
 * line cleaning, dHash, candidate merging). Not part of CI: it needs real photos.
 *
 *   npm run recognition:eval -- <folder> [--lang en|es|fr]
 *   npm run recognition:eval -- --self-test        # no photos, no database
 *
 * <folder> holds the photos (jpg, png, webp) and a labels.json mapping each file name to
 * the expected game: either its catalog id (uuid) or its exact catalog name:
 *   { "wingspan.jpg": "Wingspan", "azul.png": "3f2c…-uuid" }
 * Keep that folder OUTSIDE the repository (the photos are yours; nothing is uploaded).
 * It reads the dev catalog and its image hashes through SUPABASE_DB_PASSWORD (.env.local)
 * and `supabase link`. BoardGameGeek is never called (the test is about the local part).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { ean13Modules } from "../tests/support/ean13.ts";
import { linesFromBlocks } from "../src/features/recognition/browser/ocr.ts";
import { hashCoverBytes } from "../src/features/recognition/hash-bytes.ts";
import { parseGtin } from "../src/features/recognition/gtin.ts";
import {
  identifyGame,
  type IdentifyDeps,
} from "../src/features/recognition/identify.ts";
import { cleanOcrLines } from "../src/features/recognition/text.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const selfTest = args.includes("--self-test");
const langAt = args.indexOf("--lang");
const langFlag = langAt >= 0 ? args[langAt + 1] : undefined;
const folder = args.find((a) => !a.startsWith("--") && a !== langFlag);
const LANGS: Record<string, string[]> = {
  en: ["eng"],
  es: ["eng", "spa"],
  fr: ["eng", "fra"],
};
const langs = LANGS[langFlag ?? "en"] ?? LANGS.en;

const MAX_SIDE = 1280;

// --- engines (Node builds of the same libraries the browser uses) ------------

async function resized(file: Buffer) {
  return sharp(file).rotate().flatten({ background: "#ffffff" }).resize({
    width: MAX_SIDE,
    height: MAX_SIDE,
    fit: "inside",
    withoutEnlargement: true,
  });
}

async function readGtin(file: Buffer): Promise<string | null> {
  const { prepareZXingModule, readBarcodes } =
    await import("zxing-wasm/reader");
  const wasm = readFileSync(
    "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
  );
  prepareZXingModule({
    overrides: {
      wasmBinary: wasm.buffer.slice(
        wasm.byteOffset,
        wasm.byteOffset + wasm.byteLength,
      ) as ArrayBuffer,
    },
    fireImmediately: true,
  });
  const { data, info } = await (
    await resized(file)
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const results = await readBarcodes(
    {
      data: new Uint8ClampedArray(data),
      width: info.width,
      height: info.height,
      colorSpace: "srgb",
    } as ImageData,
    {
      formats: ["EAN13", "EAN8", "UPCA"],
      tryHarder: true,
      maxNumberOfSymbols: 2,
    },
  );
  for (const r of results) {
    const gtin = r.isValid ? parseGtin(r.text) : null;
    if (gtin) return gtin;
  }
  return null;
}

async function readTitleLines(file: Buffer): Promise<string[]> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(langs, 1, {
    langPath: "public/tesseract/lang",
    cachePath: tmpdir(), // keep the language-data cache out of the repository,
  });
  try {
    const png = await (await resized(file)).png().toBuffer();
    const { data } = await worker.recognize(png, {}, { blocks: true });
    return cleanOcrLines(linesFromBlocks(data.blocks));
  } finally {
    await worker.terminate();
  }
}

// --- self test ---------------------------------------------------------------

async function runSelfTest() {
  const GTIN = "9783161484100";
  const modules = ean13Modules(GTIN);
  const unit = 5;
  const width = 700;
  const height = 360;
  const raw = Buffer.alloc(width * height * 3, 255);
  const x0 = Math.floor((width - modules.length * unit) / 2);
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] !== "1") continue;
    for (let y = 50; y < 310; y++)
      for (let x = x0 + i * unit; x < x0 + (i + 1) * unit; x++) {
        const o = (y * width + x) * 3;
        raw[o] = raw[o + 1] = raw[o + 2] = 0;
      }
  }
  const png = await sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();

  const gtin = await readGtin(png);
  const hash = await hashCoverBytes(png);
  const ok = gtin === GTIN && !!hash && /^[0-9a-f]{16}$/.test(hash);
  console.log(`self-test barcode: ${gtin ?? "not read"} (expected ${GTIN})`);
  console.log(`self-test hash: ${hash ?? "none"}`);
  console.log(ok ? "self-test OK" : "self-test FAILED");
  process.exit(ok ? 0 : 1);
}

// --- evaluation --------------------------------------------------------------

type Labels = Record<string, string>;

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  if (selfTest) return runSelfTest();

  if (!folder || !existsSync(join(folder, "labels.json"))) {
    console.error(
      "Usage: npm run recognition:eval -- <folder with photos and labels.json> [--lang en|es|fr]",
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

  const labels: Labels = JSON.parse(
    readFileSync(join(folder, "labels.json"), "utf8"),
  );
  const catalog = (
    await db.query<{ id: string; name: string }>(
      "select id, name from public.games",
    )
  ).rows;
  const idOf = (label: string) =>
    UUID.test(label)
      ? label.toLowerCase()
      : (catalog.find((g) => g.name.toLowerCase() === label.toLowerCase())
          ?.id ?? null);

  // The real orchestration, with direct (privileged, read-only) data access and no BGG.
  const deps: IdentifyDeps = {
    findBarcode: async () => null,
    searchLocal: async (line) =>
      (
        await db.query<{ id: string; name: string }>(
          "select id, name from public.search_games($1, null, null, null, 5)",
          [line],
        )
      ).rows,
    searchExternal: async () => ({ ok: false, error: "unavailable" }),
    matchImages: async (hash) =>
      (
        await db.query<{ game_id: string; distance: number }>(
          "select game_id, distance from public.match_game_images($1)",
          [hash],
        )
      ).rows.map((r) => ({ gameId: r.game_id, distance: r.distance })),
    gameNames: async (ids) =>
      new Map(
        (
          await db.query<{ id: string; name: string }>(
            "select id, name from public.games where id = any($1)",
            [ids],
          )
        ).rows.map((r) => [r.id, r.name]),
      ),
  };

  const rankOf = async (
    input: Parameters<typeof identifyGame>[0],
    expected: string,
  ) => {
    const { candidates } = await identifyGame(input, deps);
    const i = candidates.findIndex((c) => c.gameId === expected);
    return i < 0 ? null : i + 1;
  };

  type Row = {
    file: string;
    expected: string;
    gtin: string | null;
    lines: string[];
    title: number | null;
    image: number | null;
    combined: number | null;
    ms: number;
  };
  const rows: Row[] = [];
  const unlabeled: string[] = [];

  for (const file of readdirSync(folder)
    .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
    .sort()) {
    const label = labels[file];
    const expected = label ? idOf(label) : null;
    if (!expected) {
      unlabeled.push(file);
      continue;
    }
    const bytes = readFileSync(join(folder, file));
    const started = Date.now();
    const [gtin, lines, hash] = [
      await readGtin(bytes).catch(() => null),
      await readTitleLines(bytes).catch(() => [] as string[]),
      await hashCoverBytes(bytes),
    ];
    rows.push({
      file,
      expected: label,
      gtin,
      lines,
      title: lines.length ? await rankOf({ lines }, expected) : null,
      image: hash ? await rankOf({ hash }, expected) : null,
      combined: await rankOf({ lines, ...(hash ? { hash } : {}) }, expected),
      ms: Date.now() - started,
    });
    console.log(
      `${file}: code ${gtin ?? "-"} | title ${rows.at(-1)!.title ?? "miss"} | image ${rows.at(-1)!.image ?? "miss"} | combined ${rows.at(-1)!.combined ?? "miss"} | ${JSON.stringify(lines)}`,
    );
  }
  await db.end();

  const rate = (pick: (r: Row) => number | null, k: number) =>
    rows.length
      ? `${
          rows.filter((r) => {
            const v = pick(r);
            return v !== null && v <= k;
          }).length
        }/${rows.length}`
      : "n/a";
  console.log("\n=== Results over", rows.length, "labeled photos ===");
  console.log("            top-1   top-5");
  for (const [name, pick] of [
    ["title    ", (r: Row) => r.title],
    ["image    ", (r: Row) => r.image],
    ["combined ", (r: Row) => r.combined],
  ] as const)
    console.log(`${name}  ${rate(pick, 1).padEnd(7)} ${rate(pick, 5)}`);
  console.log(
    `barcode decoded: ${rows.filter((r) => r.gtin).length}/${rows.length}`,
  );
  console.log(
    `no usable signal: ${
      rows
        .filter((r) => !r.gtin && !r.lines.length && r.image === null)
        .map((r) => r.file)
        .join(", ") || "none"
    }`,
  );
  console.log(
    `mean time per photo: ${rows.length ? Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length) : 0} ms`,
  );
  if (unlabeled.length)
    console.log(
      `skipped (not in labels.json or game not in the catalog): ${unlabeled.join(", ")}`,
    );
  const gain = rows.filter(
    (r) => (r.combined ?? 99) <= 5 && !((r.title ?? 99) <= 5),
  ).length;
  console.log(
    `DECISION AID: the picture signal rescued ${gain} photo(s) that the title alone missed in the top 5.`,
  );
}

await main();
