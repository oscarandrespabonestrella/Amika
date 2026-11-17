// Browser: the per-device store of recognition vectors (IndexedDB), with an in-memory
// fallback when IndexedDB is unavailable or errors (private mode, blocked storage, quota).
// Nothing here ever leaves the device.
import { PACK_PREFIX } from "../pack/merge";
import type { Reference, Vec } from "./rank";

export type ReferenceStore = {
  /** False when running on the in-memory fallback (nothing survives a reload). */
  persistent: boolean;
  all(): Promise<Reference[]>;
  getCover(gameId: string): Promise<{ vec: Vec; coverUrl: string } | undefined>;
  putCover(gameId: string, coverUrl: string, vec: Vec): Promise<void>;
  /** Adds a vector of a frame the user confirmed; keeps the 3 newest per game. */
  addLearned(gameId: string, vec: Vec): Promise<void>;
  remove(gameId: string): Promise<void>;
  clear(): Promise<void>;
  /**
   * Replaces ALL pack entries (kind "pack", ids `bgg:<bggId>`) with `entries` and records
   * the pack `version`, in one transaction: covers and learned vectors are never touched.
   */
  putPack(
    entries: { gameId: string; vec: Vec }[],
    version: string,
  ): Promise<void>;
  /** The version of the stored pack, or null when there is none. */
  packVersion(): Promise<string | null>;
};

type Row = {
  key: string;
  gameId: string;
  kind: "cover" | "learned" | "pack";
  vec: Float32Array;
  coverUrl?: string;
  /** Only on the pack's version row. */
  version?: string;
  at: number;
};

const DB_NAME = "amika-recognition";
const STORE = "refs";
const MAX_LEARNED = 3;
/** The pack's version lives in a row of the same store, hidden from `all()`. */
const PACK_META_KEY = "__pack_version";

const packRow = (gameId: string, vec: Vec): Row => ({
  key: `pack:${gameId}`,
  gameId,
  kind: "pack",
  vec: new Float32Array(vec),
  at: nextStamp(),
});
const metaRow = (version: string): Row => ({
  key: PACK_META_KEY,
  gameId: PACK_META_KEY,
  kind: "pack",
  vec: new Float32Array(0),
  version,
  at: nextStamp(),
});

let sequence = 0;
/** Strictly increasing, so "oldest" is well defined even within the same millisecond. */
const nextStamp = () => Date.now() * 1000 + (sequence++ % 1000);

const toReference = (row: Row): Reference => ({
  gameId: row.gameId,
  vec: row.vec,
  kind: row.kind,
});

// --- IndexedDB ----------------------------------------------------------------------

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(DB_NAME, 1);
    } catch (error) {
      return reject(error);
    }
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("byGame", "gameId");
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

function idbStore(db: IDBDatabase): ReferenceStore {
  const rowsOfGame = (store: IDBObjectStore, gameId: string) =>
    request(store.index("byGame").getAll(gameId)) as Promise<Row[]>;

  return {
    persistent: true,
    async all() {
      const rows = (await request(
        db.transaction(STORE).objectStore(STORE).getAll(),
      )) as Row[];
      return rows.filter((r) => r.key !== PACK_META_KEY).map(toReference);
    },
    async getCover(gameId) {
      const row = (await request(
        db.transaction(STORE).objectStore(STORE).get(`${gameId}:cover`),
      )) as Row | undefined;
      return row?.coverUrl === undefined
        ? undefined
        : { vec: row.vec, coverUrl: row.coverUrl };
    },
    async putCover(gameId, coverUrl, vec) {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        key: `${gameId}:cover`,
        gameId,
        kind: "cover",
        vec: new Float32Array(vec),
        coverUrl,
        at: nextStamp(),
      } satisfies Row);
      await finished(tx);
    },
    async addLearned(gameId, vec) {
      if (gameId.startsWith(PACK_PREFIX)) return; // only catalog games learn
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const at = nextStamp();
      store.put({
        key: `${gameId}:learned:${at}`,
        gameId,
        kind: "learned",
        vec: new Float32Array(vec),
        at,
      } satisfies Row);
      const learned = (await rowsOfGame(store, gameId))
        .filter((r) => r.kind === "learned")
        .sort((a, b) => a.at - b.at);
      for (const old of learned.slice(
        0,
        Math.max(0, learned.length - MAX_LEARNED),
      ))
        store.delete(old.key);
      await finished(tx);
    },
    async remove(gameId) {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const row of await rowsOfGame(store, gameId)) store.delete(row.key);
      await finished(tx);
    },
    async clear() {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      await finished(tx);
    },
    async putPack(entries, version) {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const rows = (await request(store.getAll())) as Row[];
      for (const row of rows) if (row.kind === "pack") store.delete(row.key);
      for (const e of entries) store.put(packRow(e.gameId, e.vec));
      store.put(metaRow(version));
      await finished(tx);
    },
    async packVersion() {
      const row = (await request(
        db.transaction(STORE).objectStore(STORE).get(PACK_META_KEY),
      )) as Row | undefined;
      return row?.version ?? null;
    },
  };
}

// --- in-memory fallback -------------------------------------------------------------

function memoryStore(): ReferenceStore {
  const rows = new Map<string, Row>();
  return {
    persistent: false,
    async all() {
      return [...rows.values()]
        .filter((r) => r.key !== PACK_META_KEY)
        .map(toReference);
    },
    async getCover(gameId) {
      const row = rows.get(`${gameId}:cover`);
      return row?.coverUrl === undefined
        ? undefined
        : { vec: row.vec, coverUrl: row.coverUrl };
    },
    async putCover(gameId, coverUrl, vec) {
      rows.set(`${gameId}:cover`, {
        key: `${gameId}:cover`,
        gameId,
        kind: "cover",
        vec: new Float32Array(vec),
        coverUrl,
        at: nextStamp(),
      });
    },
    async addLearned(gameId, vec) {
      if (gameId.startsWith(PACK_PREFIX)) return; // only catalog games learn
      const at = nextStamp();
      rows.set(`${gameId}:learned:${at}`, {
        key: `${gameId}:learned:${at}`,
        gameId,
        kind: "learned",
        vec: new Float32Array(vec),
        at,
      });
      const learned = [...rows.values()]
        .filter((r) => r.gameId === gameId && r.kind === "learned")
        .sort((a, b) => a.at - b.at);
      for (const old of learned.slice(
        0,
        Math.max(0, learned.length - MAX_LEARNED),
      ))
        rows.delete(old.key);
    },
    async remove(gameId) {
      for (const [key, row] of rows)
        if (row.gameId === gameId) rows.delete(key);
    },
    async clear() {
      rows.clear();
    },
    async putPack(entries, version) {
      for (const [key, row] of rows) if (row.kind === "pack") rows.delete(key);
      for (const e of entries) {
        const row = packRow(e.gameId, e.vec);
        rows.set(row.key, row);
      }
      rows.set(PACK_META_KEY, metaRow(version));
    },
    async packVersion() {
      return rows.get(PACK_META_KEY)?.version ?? null;
    },
  };
}

/** The persistent store, or an in-memory one when IndexedDB is missing or refuses to open. */
export async function openReferenceStore(
  factory: IDBFactory | undefined = typeof indexedDB === "undefined"
    ? undefined
    : indexedDB,
): Promise<ReferenceStore> {
  if (!factory) return memoryStore();
  try {
    return idbStore(await openDb(factory));
  } catch {
    return memoryStore();
  }
}
