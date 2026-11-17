// Browser-only helpers that turn the camera (or a cover from our own endpoint) into the
// plain RGBA frames the recognition code works on. Nothing here sends anything anywhere
// except the cover request to /api/covers/[gameId].
import { fitWithin } from "../browser/image-prep";
import { PACK_PREFIX } from "../pack/merge";
import type { Frame } from "./session";

/** The current camera frame, scaled so its long side is at most `maxSide`; null until ready. */
export function grabFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxSide = 640,
): Frame | null {
  if (video.videoWidth < 2 || video.videoHeight < 2) return null;
  const { width, height } = fitWithin(
    video.videoWidth,
    video.videoHeight,
    maxSide,
  );
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

/** Our own cover endpoint for a game: catalog games by uuid, pack games by BGG id. */
export function coverEndpoint(gameId: string): string {
  return gameId.startsWith(PACK_PREFIX)
    ? `/api/covers/pack/${encodeURIComponent(gameId.slice(PACK_PREFIX.length))}`
    : `/api/covers/${gameId}`;
}

/**
 * The cover of a game as a frame, through our own endpoint (it checks the user can see the
 * game and fetches the image safely). The browser caches it (Cache-Control: private).
 */
export async function fetchCoverFrame(
  gameId: string,
  fetchImpl: typeof fetch = fetch,
  maxSide = 512,
): Promise<Frame> {
  const response = await fetchImpl(coverEndpoint(gameId), {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`cover ${gameId}: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    return { data, width, height };
  } finally {
    bitmap.close();
  }
}
