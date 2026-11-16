// Browser-only. Runs the three local techniques on one photo and returns small signals:
// a barcode, up to 3 title lines and a 16-hex image hash. The photo itself is never sent
// anywhere. The heavy engines (Tesseract, zxing-wasm) are imported only when needed.
import { imageHash, prepareImage, type PreparedImage } from "./image-prep";
import type { OcrLocale } from "./ocr";

export type Stage = "prepare" | "code" | "text" | "image";

export type PhotoSignals = {
  gtin: string | null;
  lines: string[];
  hash: string;
  /** No WebAssembly: only the barcode (native) and the image hash could run. */
  unsupported: boolean;
  /** The time ran out during OCR: the other signals are still returned. */
  timedOut: boolean;
};

export type Engines = {
  prepare(file: File): Promise<PreparedImage>;
  barcode(canvas: HTMLCanvasElement): Promise<string | null>;
  ocr(
    canvas: HTMLCanvasElement,
    locale: OcrLocale,
    signal: AbortSignal,
  ): Promise<string[]>;
  hash(prepared: PreparedImage): string;
  hasWasm(): boolean;
};

export const DEFAULT_TIMEOUT_MS = 20_000;

export function defaultEngines(): Engines {
  return {
    prepare: prepareImage,
    barcode: async (canvas) => (await import("./barcode")).readBarcode(canvas),
    ocr: async (canvas, locale, signal) =>
      (await import("./ocr")).readTitleLines(canvas, locale, signal),
    hash: imageHash,
    hasWasm: () => typeof WebAssembly === "object",
  };
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

/** Rejects with an AbortError as soon as the signal aborts. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function identifyPhoto(
  file: File,
  opts: {
    locale: OcrLocale;
    signal?: AbortSignal;
    onStage?: (stage: Stage) => void;
    timeoutMs?: number;
  },
  engines: Engines = defaultEngines(),
): Promise<PhotoSignals> {
  const user = opts.signal;
  if (user?.aborted) throw abortError();

  // One signal for the engines: the user's cancel OR the overall time limit.
  const limit = new AbortController();
  const timer = setTimeout(
    () => limit.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const onUserAbort = () => limit.abort();
  user?.addEventListener("abort", onUserAbort, { once: true });
  const stage = (s: Stage) => opts.onStage?.(s);
  const cancelled = () => user?.aborted === true;

  try {
    stage("prepare");
    const prepared = await engines.prepare(file);
    if (cancelled()) throw abortError();

    stage("code");
    let gtin: string | null = null;
    try {
      gtin = await raceAbort(engines.barcode(prepared.canvas), limit.signal);
    } catch {
      if (cancelled()) throw abortError();
    }

    stage("text");
    const unsupported = !engines.hasWasm();
    let lines: string[] = [];
    if (!unsupported && !limit.signal.aborted) {
      try {
        lines = await raceAbort(
          engines.ocr(prepared.canvas, opts.locale, limit.signal),
          limit.signal,
        );
      } catch {
        if (cancelled()) throw abortError();
        lines = [];
      }
    }
    if (cancelled()) throw abortError();

    stage("image");
    const hash = engines.hash(prepared);
    return {
      gtin,
      lines,
      hash,
      unsupported,
      timedOut: limit.signal.aborted && !cancelled(),
    };
  } finally {
    clearTimeout(timer);
    user?.removeEventListener("abort", onUserAbort);
  }
}
