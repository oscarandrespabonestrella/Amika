import { FILE_PREFIX, MANUALS_CACHE, META_PREFIX } from "./constants";

// Rulebook PDFs saved ON THE USER'S DEVICE (Cache Storage), to play where there is no internet.
// The server never stores them: it only relays the bytes once, through /api/manuals/file.

export type SavedManual = {
  key: string;
  url: string;
  gameId: string;
  gameName: string;
  title: string;
  locale: string | null;
  publisher: string | null;
  /** 0 when the server did not announce a size. */
  sizeBytes: number;
  savedAt: string;
};

export type SaveInput = Omit<SavedManual, "key" | "sizeBytes" | "savedAt"> & {
  /** The proxy URL that streams this PDF (same origin). */
  source: string;
};

export type SaveError =
  | "unavailable" // no Cache Storage here (old browser, private mode)
  | "quota" // not enough room on the device
  | "too_large"
  | "rate_limited"
  | "network";

export type SaveResult =
  { ok: true; saved: SavedManual } | { ok: false; error: SaveError };

type Deps = {
  caches?: CacheStorage;
  fetchImpl?: typeof fetch;
  storage?: Pick<StorageManager, "estimate" | "persist">;
  now?: () => Date;
};

/** A short stable id for a URL (SHA-256, first 16 hex chars). */
export async function manualKey(url: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(url),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Plain strings: the Cache API resolves them against the page (and they work in tests).
const fileRequest = (key: string) => `${FILE_PREFIX}${key}`;
const metaRequest = (key: string) => `${META_PREFIX}${key}`;

export function createOfflineStore(deps: Deps = {}) {
  const cachesImpl =
    deps.caches ?? (typeof caches === "undefined" ? undefined : caches);
  const fetchImpl =
    deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const storage =
    deps.storage ??
    (typeof navigator === "undefined" ? undefined : navigator.storage);
  const now = deps.now ?? (() => new Date());

  const open = () => cachesImpl?.open(MANUALS_CACHE);

  async function enoughRoom(bytes: number): Promise<boolean> {
    try {
      const { usage, quota } = (await storage?.estimate?.()) ?? {};
      if (usage === undefined || quota === undefined) return true; // cannot tell: try
      return usage + bytes <= quota;
    } catch {
      return true;
    }
  }

  return {
    isSupported: () => Boolean(cachesImpl),

    async has(url: string): Promise<boolean> {
      const cache = await open();
      if (!cache) return false;
      return Boolean(await cache.match(metaRequest(await manualKey(url))));
    },

    async list(): Promise<SavedManual[]> {
      const cache = await open();
      if (!cache) return [];
      const keys = await cache.keys();
      const saved = await Promise.all(
        keys
          .filter((r) => new URL(r.url).pathname.startsWith(META_PREFIX))
          .map(async (r) => {
            try {
              return (await (await cache.match(r))?.json()) as
                SavedManual | undefined;
            } catch {
              return undefined;
            }
          }),
      );
      return saved
        .filter((m): m is SavedManual => Boolean(m))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },

    async save(input: SaveInput): Promise<SaveResult> {
      const cache = await open();
      if (!cache) return { ok: false, error: "unavailable" };

      const key = await manualKey(input.url);
      let response: Response;
      try {
        response = await fetchImpl(input.source, {
          credentials: "same-origin",
        });
      } catch {
        return { ok: false, error: "network" };
      }
      if (response.status === 413) return { ok: false, error: "too_large" };
      if (response.status === 429) return { ok: false, error: "rate_limited" };
      if (!response.ok || !response.body)
        return { ok: false, error: "network" };

      const declared = Number(response.headers.get("content-length"));
      const sizeBytes =
        Number.isFinite(declared) && declared > 0 ? declared : 0;
      if (sizeBytes > 0 && !(await enoughRoom(sizeBytes))) {
        await response.body.cancel().catch(() => undefined);
        return { ok: false, error: "quota" };
      }

      try {
        // Stream straight into the cache. The headers are rebuilt on purpose: the proxy sends
        // `Content-Disposition: attachment`, which would make the browser download the file
        // instead of showing it when it is opened later.
        await cache.put(
          fileRequest(key),
          new Response(response.body, {
            headers: {
              "content-type": "application/pdf",
              ...(sizeBytes > 0 ? { "content-length": String(sizeBytes) } : {}),
            },
          }),
        );
        const saved: SavedManual = {
          key,
          url: input.url,
          gameId: input.gameId,
          gameName: input.gameName,
          title: input.title,
          locale: input.locale,
          publisher: input.publisher,
          sizeBytes,
          savedAt: now().toISOString(),
        };
        await cache.put(
          metaRequest(key),
          new Response(JSON.stringify(saved), {
            headers: { "content-type": "application/json" },
          }),
        );
        // Ask the browser not to evict it under storage pressure (best effort).
        void storage?.persist?.().catch(() => undefined);
        return { ok: true, saved };
      } catch (error) {
        await cache.delete(fileRequest(key)).catch(() => undefined);
        const quota =
          error instanceof DOMException && error.name === "QuotaExceededError";
        return { ok: false, error: quota ? "quota" : "network" };
      }
    },

    async remove(url: string): Promise<void> {
      const cache = await open();
      if (!cache) return;
      const key = await manualKey(url);
      await cache.delete(fileRequest(key));
      await cache.delete(metaRequest(key));
    },
  };
}

export type OfflineStore = ReturnType<typeof createOfflineStore>;
