import "server-only";
import { fetchCoverBytes, type FetchLike } from "./cover-fetch";
import { hashCoverBytes } from "./hash-bytes";

// Kept until the image hash is retired (Phase 7a-2, Task 7): the fetching code moved to
// cover-fetch.ts and is re-exported here so existing imports keep working.
export { fetchCoverBytes, isAllowedCoverUrl } from "./cover-fetch";
export { hashCoverBytes };

export async function hashCover(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const bytes = await fetchCoverBytes(url, fetchImpl);
  return bytes ? hashCoverBytes(bytes) : null;
}
