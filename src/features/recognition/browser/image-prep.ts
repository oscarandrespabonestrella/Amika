// Browser-only. Turns a photo file into a bounded canvas and a perceptual hash. Pure
// helpers (fitWithin, grayFromRgba, hashFromRgba) are unit tested; the canvas parts are
// exercised by the E2E suite.
import { dHashFromGray, grayGrid } from "../dhash";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SIDE = 1280;

export type ImageErrorCode =
  "not_image" | "too_large" | "unreadable" | "timeout";

export class ImageError extends Error {
  readonly code: ImageErrorCode;
  constructor(code: ImageErrorCode) {
    super(code);
    this.name = "ImageError";
    this.code = code;
  }
}

export type PreparedImage = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
};

/** Scales down (never up) so the longest side is at most `max`; sides stay >= 1. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Luminance of RGBA pixels, transparency composited over white (like the server). */
export function grayFromRgba(rgba: ArrayLike<number>): number[] {
  const out = new Array<number>(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const r = rgba[i * 4] * a + 255 * (1 - a);
    const g = rgba[i * 4 + 1] * a + 255 * (1 - a);
    const b = rgba[i * 4 + 2] * a + 255 * (1 - a);
    out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

export function hashFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): string {
  return dHashFromGray(grayGrid(grayFromRgba(rgba), width, height));
}

/**
 * Decodes the photo (honoring EXIF orientation) into a canvas of at most 1280 px on the
 * long side, on a white background. The file is never uploaded anywhere.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new ImageError("not_image");
  if (file.size > MAX_FILE_BYTES) throw new ImageError("too_large");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError("unreadable");
  }
  try {
    if (bitmap.width < 1 || bitmap.height < 1)
      throw new ImageError("unreadable");
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new ImageError("unreadable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { canvas, width, height };
  } finally {
    bitmap.close();
  }
}

/** The 16-hex-character dHash of a prepared image. */
export function imageHash(prepared: PreparedImage): string {
  const ctx = prepared.canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new ImageError("unreadable");
  const { data } = ctx.getImageData(0, 0, prepared.width, prepared.height);
  return hashFromRgba(data, prepared.width, prepared.height);
}
