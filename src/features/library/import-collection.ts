// Pure orchestration of one batch of a BGG collection import: make sure the games are in
// the catalog (one upstream call for the whole batch), then add them to the user's library.
// Dependencies are injected so it is tested without Supabase or BoardGameGeek.
import type { LibraryStatus } from "./schemas";

export type BatchRow = {
  bggId: string;
  status: LibraryStatus;
  rating: number | null;
};

export type ImportBatchError = "unavailable" | "rate_limited" | "failed";

export type ImportBatchResult =
  | { ok: true; added: number; existing: number; failed: string[] }
  | { ok: false; error: ImportBatchError };

export async function importCollectionBatch(
  rows: BatchRow[],
  deps: {
    importGames(
      bggIds: string[],
    ): Promise<
      | { ok: true; games: Map<string, string>; failed: string[] }
      | { ok: false; error: string }
    >;
    addItems(
      items: { gameId: string; status: LibraryStatus; rating: number | null }[],
    ): Promise<{ added: number; existing: number }>;
  },
): Promise<ImportBatchResult> {
  const imported = await deps.importGames(rows.map((r) => r.bggId));
  if (!imported.ok) {
    const error: ImportBatchError =
      imported.error === "unavailable" || imported.error === "rate_limited"
        ? imported.error
        : "failed";
    return { ok: false, error };
  }

  const items = rows.flatMap((row) => {
    const gameId = imported.games.get(row.bggId);
    return gameId ? [{ gameId, status: row.status, rating: row.rating }] : [];
  });
  const { added, existing } = await deps.addItems(items);
  return { ok: true, added, existing, failed: imported.failed };
}
