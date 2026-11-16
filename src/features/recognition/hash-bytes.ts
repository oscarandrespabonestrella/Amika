// Server-side hash of image bytes (sharp). No `server-only`: it fetches nothing, so the
// E2E suite can import it to compare with the browser's hash. The fetching code, which
// needs the SSRF guards, stays in cover-hash.ts (server-only).
import { dHashFromGray, grayGrid } from "./dhash";

// A cover never needs more; also bounds the memory a hostile image can claim.
const MAX_INPUT_PIXELS = 25_000_000;

/**
 * dHash of an image: EXIF-rotated, flattened over white, grayscale, resized to exactly
 * a 9x8 box average. The browser does the same with a canvas (tolerance: Hamming
 * distance <= 6, tested).
 */
export async function hashCoverBytes(
  bytes: Uint8Array,
): Promise<string | null> {
  if (bytes.byteLength === 0) return null;
  try {
    const { default: sharp } = await import("sharp");
    // Same recipe as the browser: at most 1280 px on the long side, transparency over
    // white, luminance, then the shared 9x8 box average.
    const { data, info } = await sharp(Buffer.from(bytes), {
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return dHashFromGray(grayGrid(data, info.width, info.height));
  } catch {
    return null;
  }
}
