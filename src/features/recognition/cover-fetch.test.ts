import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { coverJpeg } from "./cover-fetch";

const meta = async (bytes: Uint8Array) => sharp(Buffer.from(bytes)).metadata();

async function pngOf(width: number, height: number, channels: 3 | 4 = 3) {
  return sharp({
    create: {
      width,
      height,
      channels,
      background:
        channels === 4
          ? { r: 0, g: 0, b: 0, alpha: 0 }
          : { r: 200, g: 40, b: 40 },
    },
  })
    .png()
    .toBuffer();
}

describe("coverJpeg", () => {
  it("shrinks a large cover to at most 512 px on the long side, as a JPEG", async () => {
    const out = (await coverJpeg(await pngOf(3000, 2000)))!;
    const m = await meta(out);
    expect(m.format).toBe("jpeg");
    expect(Math.max(m.width!, m.height!)).toBe(512);
    expect(m.width!).toBeGreaterThan(m.height!); // aspect ratio kept
  });

  it("never enlarges a small cover", async () => {
    const m = await meta((await coverJpeg(await pngOf(200, 100)))!);
    expect([m.width, m.height]).toEqual([200, 100]);
  });

  it("flattens transparency over white (a JPEG has no alpha)", async () => {
    const out = (await coverJpeg(await pngOf(50, 50, 4)))!;
    const { data } = await sharp(Buffer.from(out))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240); // white, not black
  });

  it("applies the EXIF orientation", async () => {
    const tall = await sharp({
      create: { width: 400, height: 200, channels: 3, background: "#808080" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const m = await meta((await coverJpeg(tall))!);
    expect(m.height!).toBeGreaterThan(m.width!); // rotated upright
  });

  it("refuses an image of more than 25 megapixels", async () => {
    const bomb = await sharp({
      create: { width: 6000, height: 5000, channels: 3, background: "#808080" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(await coverJpeg(bomb)).toBeNull();
  });

  it("an offline caller can raise the pixel limit; the default still refuses", async () => {
    // 27 MP, like some BGG originals (the pack generator needs them).
    const big = await sharp({
      create: { width: 5200, height: 5200, channels: 3, background: "#808080" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(await coverJpeg(big)).toBeNull();
    const out = await coverJpeg(big, { maxInputPixels: 64_000_000 });
    expect(out).not.toBeNull();
    const m = await meta(out!);
    expect(Math.max(m.width!, m.height!)).toBe(512);
  });

  it("refuses SVG, corrupt and empty input", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    expect(await coverJpeg(svg)).toBeNull();
    expect(await coverJpeg(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(await coverJpeg(new Uint8Array())).toBeNull();
  });
});
