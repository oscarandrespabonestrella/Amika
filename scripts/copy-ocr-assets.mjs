#!/usr/bin/env node
/**
 * Copies the self-hosted engines of the local game recognition (Phase 7a) from node_modules
 * into public/ (git-ignored), so nothing is ever fetched from a CDN at runtime:
 *
 *   public/tesseract/worker.min.js            Tesseract web worker
 *   public/tesseract/core/*-lstm.wasm.js      OCR engine (LSTM only; the worker picks the build)
 *   public/tesseract/lang/{eng,spa,fra}.traineddata.gz   language data (best, integer)
 *   public/zxing/zxing_reader.wasm            barcode reader (fallback when the browser has
 *                                             no native BarcodeDetector)
 *
 * Runs before `dev` and `build` (predev / prebuild). Idempotent and fast when up to date;
 * fails loudly if a source file is missing.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const nm = (...p) => join(root, "node_modules", ...p);
const out = (...p) => join(root, "public", ...p);

const files = [
  [
    nm("tesseract.js", "dist", "worker.min.js"),
    out("tesseract", "worker.min.js"),
  ],
  ...[
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-relaxedsimd-lstm.wasm.js",
  ].map((f) => [nm("tesseract.js-core", f), out("tesseract", "core", f)]),
  ...["eng", "spa", "fra"].map((l) => [
    nm("@tesseract.js-data", l, "4.0.0_best_int", `${l}.traineddata.gz`),
    out("tesseract", "lang", `${l}.traineddata.gz`),
  ]),
  [
    nm("zxing-wasm", "dist", "reader", "zxing_reader.wasm"),
    out("zxing", "zxing_reader.wasm"),
  ],
];

let copied = 0;
let bytes = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.error(`copy-ocr-assets: missing source ${from} (run npm install)`);
    process.exit(1);
  }
  const size = statSync(from).size;
  if (existsSync(to) && statSync(to).size === size) {
    bytes += size;
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
  bytes += size;
}
console.log(
  `copy-ocr-assets: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB, ${copied} copied`,
);
