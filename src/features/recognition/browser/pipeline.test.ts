import { describe, expect, it, vi } from "vitest";
import { ImageError } from "./image-prep";
import { identifyPhoto, type Engines, type Stage } from "./pipeline";

const FILE = new File(["x"], "box.jpg", { type: "image/jpeg" });
const PREPARED = { canvas: {} as HTMLCanvasElement, width: 10, height: 10 };

function engines(over: Partial<Engines> = {}) {
  return {
    prepare: vi.fn(async () => PREPARED),
    barcode: vi.fn(async () => "9783161484100" as string | null),
    ocr: vi.fn(async () => ["WINGSPAN"]),
    hash: vi.fn(() => "0123456789abcdef"),
    hasWasm: vi.fn(() => true),
    ...over,
  } as Engines & Record<keyof Engines, ReturnType<typeof vi.fn>>;
}

/** Never resolves; rejects as soon as the signal aborts (as a real worker would). */
const hangUntilAbort = (
  _canvas: unknown,
  _locale: unknown,
  signal: AbortSignal,
) =>
  new Promise<string[]>((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(new Error("aborted"))),
  );

describe("identifyPhoto", () => {
  it("runs prepare, code, text, image in that order and combines the signals", async () => {
    const stages: Stage[] = [];
    const result = await identifyPhoto(
      FILE,
      { locale: "en", onStage: (s) => stages.push(s) },
      engines(),
    );
    expect(stages).toEqual(["prepare", "code", "text", "image"]);
    expect(result).toEqual({
      gtin: "9783161484100",
      lines: ["WINGSPAN"],
      hash: "0123456789abcdef",
      unsupported: false,
      timedOut: false,
    });
  });

  it("a failing barcode reader does not stop the text and image signals", async () => {
    const e = engines({
      barcode: vi.fn(async () => {
        throw new Error("no detector");
      }),
    });
    const result = await identifyPhoto(FILE, { locale: "en" }, e);
    expect(result.gtin).toBeNull();
    expect(result.lines).toEqual(["WINGSPAN"]);
    expect(result.hash).toBe("0123456789abcdef");
  });

  it("without WebAssembly it skips OCR, flags it and still returns the hash", async () => {
    const e = engines({ hasWasm: vi.fn(() => false) });
    const result = await identifyPhoto(FILE, { locale: "en" }, e);
    expect(e.ocr).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      unsupported: true,
      lines: [],
      hash: "0123456789abcdef",
    });
  });

  it("on timeout during OCR it degrades: keeps the code and the hash, flags timedOut", async () => {
    const e = engines({ ocr: vi.fn(hangUntilAbort) });
    const result = await identifyPhoto(
      FILE,
      { locale: "en", timeoutMs: 30 },
      e,
    );
    expect(result).toMatchObject({
      gtin: "9783161484100",
      lines: [],
      hash: "0123456789abcdef",
      timedOut: true,
    });
  });

  it("a user cancel rejects with an AbortError, aborts OCR and computes no hash", async () => {
    const ctl = new AbortController();
    const e = engines({ ocr: vi.fn(hangUntilAbort) });
    const pending = identifyPhoto(
      FILE,
      { locale: "en", signal: ctl.signal },
      e,
    );
    await new Promise((r) => setTimeout(r, 10));
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(e.hash).not.toHaveBeenCalled();
  });

  it("an unreadable file surfaces its ImageError", async () => {
    const e = engines({
      prepare: vi.fn(async () => {
        throw new ImageError("not_image");
      }),
    });
    await expect(
      identifyPhoto(FILE, { locale: "en" }, e),
    ).rejects.toMatchObject({ code: "not_image" });
    expect(e.ocr).not.toHaveBeenCalled();
  });

  it("cancelled before starting never touches the engines", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const e = engines();
    await expect(
      identifyPhoto(FILE, { locale: "en", signal: ctl.signal }, e),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(e.prepare).not.toHaveBeenCalled();
  });
});
