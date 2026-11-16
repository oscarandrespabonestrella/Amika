import { describe, expect, it, vi, type Mock } from "vitest";
import {
  linesFromBlocks,
  ocrLanguages,
  readTitleLines,
  type OcrWorker,
} from "./ocr";

describe("ocrLanguages", () => {
  it("is English plus the interface language", () => {
    expect(ocrLanguages("en")).toEqual(["eng"]);
    expect(ocrLanguages("es")).toEqual(["eng", "spa"]);
    expect(ocrLanguages("fr")).toEqual(["eng", "fra"]);
  });
});

describe("linesFromBlocks", () => {
  const block = {
    paragraphs: [
      {
        lines: [
          { text: " WINGSPAN \n", confidence: 91, bbox: { y0: 10, y1: 60 } },
          { text: "A game", confidence: 70, bbox: { y0: 70, y1: 90 } },
        ],
      },
    ],
  };
  it("flattens blocks, paragraphs and lines with their print height", () => {
    expect(linesFromBlocks([block])).toEqual([
      { text: "WINGSPAN", confidence: 91, height: 50 },
      { text: "A game", confidence: 70, height: 20 },
    ]);
  });
  it("tolerates missing or malformed structures", () => {
    expect(linesFromBlocks(null)).toEqual([]);
    expect(linesFromBlocks("nope")).toEqual([]);
    expect(
      linesFromBlocks([
        {},
        { paragraphs: [{}] },
        { paragraphs: [{ lines: [{}] }] },
      ]),
    ).toEqual([]);
  });
});

type FakeWorker = OcrWorker & {
  recognize: Mock<OcrWorker["recognize"]>;
  terminate: Mock<OcrWorker["terminate"]>;
};

function fakeWorker(
  result: unknown,
  opts: { hang?: boolean } = {},
): FakeWorker {
  return {
    recognize: vi.fn<OcrWorker["recognize"]>(() =>
      opts.hang
        ? new Promise(() => undefined)
        : Promise.resolve({ data: result as { blocks?: unknown } }),
    ),
    terminate: vi.fn<OcrWorker["terminate"]>(async () => undefined),
  };
}
const canvas = {} as HTMLCanvasElement;

describe("readTitleLines", () => {
  it("returns cleaned lines and always terminates the worker", async () => {
    const worker = fakeWorker({
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                { text: "WINGSPAN", confidence: 90, bbox: { y0: 0, y1: 50 } },
                { text: "xx", confidence: 95, bbox: { y0: 0, y1: 90 } },
              ],
            },
          ],
        },
      ],
    });
    const create = vi.fn<(langs: string[]) => Promise<OcrWorker>>(
      async () => worker,
    );
    const lines = await readTitleLines(
      canvas,
      "es",
      new AbortController().signal,
      create,
    );
    expect(lines).toEqual(["WINGSPAN"]);
    expect(create).toHaveBeenCalledWith(["eng", "spa"]);
    expect(worker.recognize).toHaveBeenCalledWith(canvas, {}, { blocks: true });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates the worker and rejects when aborted mid-recognition", async () => {
    const worker = fakeWorker(null, { hang: true });
    const ctl = new AbortController();
    const pending = readTitleLines(
      canvas,
      "en",
      ctl.signal,
      async () => worker,
    );
    await new Promise((r) => setTimeout(r, 5));
    ctl.abort();
    await expect(pending).rejects.toThrow();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates the worker when recognition throws", async () => {
    const worker = fakeWorker(null);
    worker.recognize.mockRejectedValueOnce(new Error("boom"));
    await expect(
      readTitleLines(
        canvas,
        "en",
        new AbortController().signal,
        async () => worker,
      ),
    ).rejects.toThrow("boom");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not even start when already aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const create = vi.fn<(langs: string[]) => Promise<OcrWorker>>(async () =>
      fakeWorker({}),
    );
    await expect(
      readTitleLines(canvas, "en", ctl.signal, create),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
