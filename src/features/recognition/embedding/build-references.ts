// Turns the covers of the catalog into reference vectors, once per device. Incremental
// (unchanged covers are skipped), tolerant (one failing cover never stops the rest) and
// cancellable. The embedding itself is injected, so this is pure orchestration.
import { PACK_PREFIX } from "../pack/merge";
import type { Vec } from "./rank";
import type { ReferenceStore } from "./reference-store";

export type BuildResult = { built: number; skipped: number; failed: string[] };

export async function buildReferences(opts: {
  games: { id: string; coverUrl: string | null }[];
  store: ReferenceStore;
  /** Fetches the cover (our own endpoint) and returns its vector. */
  embedCover(gameId: string): Promise<Vec>;
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
  /**
   * Remove the vectors of games missing from `games`. Pass false when the list may be
   * incomplete (cut by a cap, or the listing failed): a missing game is then not a deleted one.
   */
  purge?: boolean;
}): Promise<BuildResult> {
  const { games, store, embedCover, onProgress, signal, purge = true } = opts;
  const result: BuildResult = { built: 0, skipped: 0, failed: [] };

  // Games that left the catalog take their vectors (covers and learned) with them.
  if (purge) {
    const known = new Set(games.map((g) => g.id));
    const stored = new Set((await store.all()).map((r) => r.gameId));
    for (const id of stored)
      if (!known.has(id) && !id.startsWith(PACK_PREFIX)) await store.remove(id);
  }

  let done = 0;
  for (const game of games) {
    if (signal?.aborted) break;
    if (!game.coverUrl) {
      result.skipped++;
    } else {
      const cached = await store.getCover(game.id);
      if (cached && cached.coverUrl === game.coverUrl) {
        result.skipped++;
      } else {
        try {
          await store.putCover(
            game.id,
            game.coverUrl,
            await embedCover(game.id),
          );
          result.built++;
        } catch {
          result.failed.push(game.id);
        }
      }
    }
    onProgress?.(++done, games.length);
  }
  return result;
}
