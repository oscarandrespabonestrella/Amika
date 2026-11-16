// Browser-only. Reads the biggest printed lines of a picture with Tesseract (WebAssembly)
// running in a Web Worker. Everything is self-hosted under /tesseract/ (worker, core and
// language data copied from npm packages by copy-ocr-assets.mjs): nothing is fetched from
// a CDN and the photo never leaves the device.
import { cleanOcrLines, type OcrLine } from "../text";

export type OcrLocale = "en" | "es" | "fr";

const LANGUAGE: Record<OcrLocale, string[]> = {
  en: ["eng"],
  es: ["eng", "spa"],
  fr: ["eng", "fra"],
};

export function ocrLanguages(locale: OcrLocale): string[] {
  return LANGUAGE[locale];
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** blocks > paragraphs > lines, defensively (the structure comes from a library). */
export function linesFromBlocks(blocks: unknown): OcrLine[] {
  const out: OcrLine[] = [];
  for (const block of asArray(blocks))
    for (const paragraph of asArray(asRecord(block).paragraphs))
      for (const line of asArray(asRecord(paragraph).lines)) {
        const l = asRecord(line);
        const bbox = asRecord(l.bbox);
        if (typeof l.text !== "string") continue;
        const text = l.text.trim();
        if (!text) continue;
        out.push({
          text,
          confidence: typeof l.confidence === "number" ? l.confidence : 0,
          height:
            typeof bbox.y1 === "number" && typeof bbox.y0 === "number"
              ? bbox.y1 - bbox.y0
              : 0,
        });
      }
  return out;
}

/** The slice of a Tesseract worker this module uses (so tests can fake it). */
export type OcrWorker = {
  recognize(
    image: HTMLCanvasElement,
    options: object,
    output: { blocks: true },
  ): Promise<{ data: { blocks?: unknown } }>;
  terminate(): Promise<unknown>;
};

async function createTesseractWorker(langs: string[]): Promise<OcrWorker> {
  const { createWorker } = await import("tesseract.js");
  return (await createWorker(langs, 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
  })) as unknown as OcrWorker;
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Up to 3 cleaned title lines, biggest print first. Always terminates the worker, also
 * when aborted (the user cancelled or the time ran out) or when recognition throws.
 */
export async function readTitleLines(
  canvas: HTMLCanvasElement,
  locale: OcrLocale,
  signal: AbortSignal,
  create: (langs: string[]) => Promise<OcrWorker> = createTesseractWorker,
): Promise<string[]> {
  if (signal.aborted) throw abortError();
  const worker = await create(ocrLanguages(locale));
  let onAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const { data } = await Promise.race([
      worker.recognize(canvas, {}, { blocks: true }),
      aborted,
    ]);
    return cleanOcrLines(linesFromBlocks(data.blocks));
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    await worker.terminate().catch(() => undefined);
  }
}
