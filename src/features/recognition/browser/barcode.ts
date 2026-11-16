// Browser-only. Reads an EAN-13 / EAN-8 / UPC-A barcode from a canvas: the native
// BarcodeDetector when the browser has one, otherwise (or when it finds nothing)
// zxing-wasm, whose .wasm file is self-hosted under /zxing/ (see copy-ocr-assets.mjs).
import { parseGtin } from "../gtin";

/** The first raw value that is a valid GTIN, normalized to 13 digits. */
export function pickGtin(raws: string[]): string | null {
  for (const raw of raws) {
    const gtin = parseGtin(raw);
    if (gtin) return gtin;
  }
  return null;
}

type NativeDetector = {
  detect(image: HTMLCanvasElement): Promise<{ rawValue: string }[]>;
};

async function readNative(canvas: HTMLCanvasElement): Promise<string | null> {
  const Detector = (
    globalThis as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => NativeDetector;
    }
  ).BarcodeDetector;
  if (!Detector) return null;
  const found = await new Detector({
    formats: ["ean_13", "ean_8", "upc_a"],
  }).detect(canvas);
  return pickGtin(found.map((f) => f.rawValue));
}

// One stable overrides object and a single prepare: zxing-wasm discards its compiled
// module whenever the overrides it is given differ, so a fresh closure per read would
// re-instantiate the WebAssembly on every photo.
const ZXING_OVERRIDES = {
  locateFile: (path: string, prefix: string) =>
    path.endsWith(".wasm") ? "/zxing/zxing_reader.wasm" : prefix + path,
};
let zxingPrepared = false;

async function readWithZxing(
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  if (typeof WebAssembly !== "object") return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { prepareZXingModule, readBarcodes } =
    await import("zxing-wasm/reader");
  if (!zxingPrepared) {
    prepareZXingModule({ overrides: ZXING_OVERRIDES });
    zxingPrepared = true;
  }
  const results = await readBarcodes(
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    {
      formats: ["EAN13", "EAN8", "UPCA"],
      tryHarder: true,
      maxNumberOfSymbols: 2,
    },
  );
  return pickGtin(results.filter((r) => r.isValid).map((r) => r.text));
}

/** A valid GTIN found in the picture, or null. Never throws for "nothing found". */
export async function readBarcode(
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  try {
    const native = await readNative(canvas);
    if (native) return native;
  } catch {
    // fall through to the WebAssembly reader
  }
  return readWithZxing(canvas);
}
