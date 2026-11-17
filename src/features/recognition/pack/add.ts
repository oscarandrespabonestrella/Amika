// Pure orchestration of "Add to catalog and open" for a game of the reference pack: import
// it from BoardGameGeek (the server action checks the session and the daily quota), then
// remember the frame the user was looking at for the imported game. Dependencies injected.
import type { PackGameInfo } from "./manifest";

export type AddPackResult =
  { ok: true; gameId: string } | { ok: false; error: string };

export async function addPackGame(
  gameId: string,
  deps: {
    info(id: string): PackGameInfo | null;
    importGame(
      bggId: string,
    ): Promise<{ ok: true; gameId: string } | { ok: false; error: string }>;
    /** Stores the current frame's vector (and a taught barcode) for the catalog game. */
    confirm(catalogGameId: string): Promise<void>;
  },
): Promise<AddPackResult> {
  const info = deps.info(gameId);
  if (!info) return { ok: false, error: "failed" };
  let imported: Awaited<ReturnType<typeof deps.importGame>>;
  try {
    imported = await deps.importGame(info.bggId);
  } catch {
    return { ok: false, error: "failed" };
  }
  if (!imported.ok) return { ok: false, error: imported.error };
  // The game IS in the catalog now: failing to remember the frame must not block opening it.
  await deps.confirm(imported.gameId).catch(() => undefined);
  return { ok: true, gameId: imported.gameId };
}
