// Browser: downloads the reference pack (the precomputed vectors of BoardGameGeek's top
// 500) from OUR origin into the per-device store. Only called after the user opted in.
// All or nothing: a failed, truncated or aborted download leaves the previous pack as it was.
import type { ReferenceStore } from "../embedding/reference-store";
import { decodePack } from "./format";
import type { PackManifest } from "./manifest";
import { PACK_PREFIX } from "./merge";

export type EnsurePackDeps = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Loaded with a dynamic import so the manifest never enters the first-load JS. */
  loadManifest?: () => Promise<PackManifest>;
};

/** The only dynamic import of the manifest: one chunk, loaded after the opt-in. */
const loadManifestModule = () => import("./manifest");

const defaultLoadManifest = async () =>
  (await loadManifestModule()).getPackManifest();

/** Name and BGG rank of a pack game id, from the same lazily loaded manifest. */
export async function loadPackGameInfo() {
  return (await loadManifestModule()).packGameInfo;
}

export async function ensurePack(
  store: ReferenceStore,
  deps: EnsurePackDeps = {},
): Promise<{ installed: boolean; games: number; aborted?: true }> {
  const {
    fetchImpl = fetch,
    signal,
    loadManifest = defaultLoadManifest,
  } = deps;
  try {
    const manifest = await loadManifest();
    if ((await store.packVersion()) === manifest.version)
      return { installed: true, games: manifest.games.length };

    const response = await fetchImpl(`/reference-pack/${manifest.vectors}`, {
      credentials: "same-origin",
      signal,
    });
    if (!response.ok) throw new Error(`pack ${response.status}`);
    const vecs = decodePack(
      new Uint8Array(await response.arrayBuffer()),
      manifest.games.length,
    );
    await store.putPack(
      manifest.games.map((g, i) => ({
        gameId: `${PACK_PREFIX}${g.bggId}`,
        vec: vecs[i],
      })),
      manifest.version,
    );
    return { installed: true, games: manifest.games.length };
  } catch {
    // Offline, aborted, truncated, corrupt or storage full: the catalog still works.
    // An abort is reported so that a Cancel pressed during the opt-in can stay a Cancel.
    return signal?.aborted
      ? { installed: false, games: 0, aborted: true }
      : { installed: false, games: 0 };
  }
}
