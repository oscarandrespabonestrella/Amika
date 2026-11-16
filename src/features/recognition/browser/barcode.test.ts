import { describe, expect, it, vi } from "vitest";

vi.mock("zxing-wasm/reader", () => ({
  prepareZXingModule: vi.fn(),
  readBarcodes: vi.fn(async () => []),
}));

import { prepareZXingModule } from "zxing-wasm/reader";
import { pickGtin, readBarcode } from "./barcode";

describe("pickGtin", () => {
  it("returns the first value with a valid check digit, normalized to 13 digits", () => {
    expect(pickGtin(["nonsense", "036000291452", "9783161484100"])).toBe(
      "0036000291452",
    );
  });
  it("is null when nothing is a valid GTIN", () => {
    expect(pickGtin([])).toBeNull();
    expect(pickGtin(["", "123", "9783161484101"])).toBeNull();
  });
});

describe("readBarcode (zxing fallback)", () => {
  const canvas = {
    width: 2,
    height: 2,
    getContext: () => ({
      getImageData: () => ({
        data: new Uint8ClampedArray(16),
        width: 2,
        height: 2,
      }),
    }),
  } as unknown as HTMLCanvasElement;

  it("prepares the WebAssembly module with the same overrides on every read (no re-instantiation)", async () => {
    await readBarcode(canvas);
    await readBarcode(canvas);
    await readBarcode(canvas);
    const overrides = vi
      .mocked(prepareZXingModule)
      .mock.calls.map((call) => call[0]?.overrides);
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    expect(new Set(overrides).size).toBe(1);
  });

  it("reads nothing from a picture without a barcode", async () => {
    expect(await readBarcode(canvas)).toBeNull();
  });
});
