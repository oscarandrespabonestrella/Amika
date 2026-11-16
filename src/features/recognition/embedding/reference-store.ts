// Browser: the per-device store of recognition vectors (IndexedDB), with an in-memory
// fallback when IndexedDB is unavailable or errors (private mode, blocked storage, quota).
// Nothing here ever leaves the device.
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
};

type Row = {
  key: string;
  gameId: string;
  kind: "cover" | "learned";
  vec: Float32Array;
  coverUrl?: string;
  at: number;
};

const DB_NAME = "amika-recognition";
const STORE = "refs";
const MAX_LEARNED = 3;

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
      return rows.map(toReference);
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
  };
}

// --- in-memory fallback -------------------------------------------------------------

function memoryStore(): ReferenceStore {
  const rows = new Map<string, Row>();
  return {
    persistent: false,
    async all() {
      return [...rows.values()].map(toReference);
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
