// Browser-only. Turns a photo file into a bounded canvas. The pure helper (fitWithin) is
// unit tested; the canvas part is exercised by the E2E suite.
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
