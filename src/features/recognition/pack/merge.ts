// Pure. The catalog wins over the pack: a BGG game that is in the user's catalog is
// recognized through its own references (cover and learned), so its pack entry is hidden.
import type { Reference } from "../embedding/rank";

export const PACK_PREFIX = "bgg:";

/**
 * The store holds catalog covers, learned vectors and pack entries in one list: split it
 * and apply the catalog-wins rule with the BGG ids of the user's catalog games.
 */
export function assembleReferences(
  all: Reference[],
  games: { bggId: string | null }[],
  options: { includePack?: boolean } = {},
): Reference[] {
  const { includePack = true } = options;
  const catalogBggIds = new Set(
    games.flatMap((g) => (g.bggId ? [g.bggId] : [])),
  );
  return mergeReferences(
    all.filter((r) => r.kind !== "pack"),
    // A pack that could not be named (its manifest failed to load) must not answer at all.
    includePack ? all.filter((r) => r.kind === "pack") : [],
    catalogBggIds,
  );
}

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
