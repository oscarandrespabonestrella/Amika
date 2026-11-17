// Pure. The catalog wins over the pack: a BGG game that is in the user's catalog is
// recognized through its own references (cover and learned), so its pack entry is hidden.
import type { Reference } from "../embedding/rank";

export const PACK_PREFIX = "bgg:";

export function mergeReferences(
  catalog: Reference[],
  pack: Reference[],
  catalogBggIds: ReadonlySet<string>,
): Reference[] {
  return [
    ...catalog,
    ...pack.filter(
      (r) =>
        !(
          r.gameId.startsWith(PACK_PREFIX) &&
          catalogBggIds.has(r.gameId.slice(PACK_PREFIX.length))
        ),
    ),
  ];
}
