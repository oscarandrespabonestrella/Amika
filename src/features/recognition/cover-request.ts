// Pure: the decision table of GET /api/covers/[gameId], with its data access injected so
// it can be tested. The route (src/app/api/covers/[gameId]/route.ts) wires the real ones.
import { z } from "zod";

export type CoverDeps = {
  /** The signed-in user id, or null. */
  userId(): Promise<string | null>;
  /** The game's cover URL AS THE USER (RLS): null if missing, not visible or without cover. */
  findCoverUrl(gameId: string): Promise<string | null>;
  isAllowed(url: string): boolean;
  fetchCover(url: string): Promise<Uint8Array | null>;
  toJpeg(bytes: Uint8Array): Promise<Uint8Array | null>;
};

export type CoverResponse =
  | { status: 200; body: Uint8Array; headers: Record<string, string> }
  | { status: 401 | 404 | 502 };

function jpegResponse(jpeg: Uint8Array): CoverResponse {
  return {
    status: 200,
    body: jpeg,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.byteLength),
      "Cache-Control": "private, max-age=604800",
      "X-Content-Type-Options": "nosniff",
    },
  };
}

export async function handleCoverRequest(
  gameId: string,
  deps: CoverDeps,
): Promise<CoverResponse> {
  if (!(await deps.userId())) return { status: 401 };
  // Malformed id: 404 without touching the database or the network.
  if (!z.uuid().safeParse(gameId).success) return { status: 404 };

  // Missing, not visible to this user, or no cover: all the same 404 (no probing).
  const url = await deps.findCoverUrl(gameId);
  if (!url || !deps.isAllowed(url)) return { status: 404 };

  const bytes = await deps.fetchCover(url);
  if (!bytes) return { status: 502 };
  const jpeg = await deps.toJpeg(bytes);
  if (!jpeg) return { status: 502 };

  return jpegResponse(jpeg);
}

export type PackCoverDeps = Omit<CoverDeps, "findCoverUrl"> & {
  /** The cover URL the PACK MANIFEST lists for this BGG id, or null if it is not in the pack. */
  packCoverUrl(bggId: string): string | null;
};

/**
 * GET /api/covers/pack/[bggId]: the cover of a game of the reference pack. The URL comes
 * from the manifest, never from the request, so this cannot be used as an open proxy.
 */
export async function handlePackCoverRequest(
  bggId: string,
  deps: PackCoverDeps,
): Promise<CoverResponse> {
  if (!(await deps.userId())) return { status: 401 };
  // Anything but 1-9 digits: 404 without a lookup or a network call.
  if (!/^\d{1,9}$/.test(bggId)) return { status: 404 };

  const url = deps.packCoverUrl(bggId);
  if (!url || !deps.isAllowed(url)) return { status: 404 };

  const bytes = await deps.fetchCover(url);
  if (!bytes) return { status: 502 };
  const jpeg = await deps.toJpeg(bytes);
  if (!jpeg) return { status: 502 };
  return jpegResponse(jpeg);
}
