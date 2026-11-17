import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { normalize } from "../embedding/rank";
import { openReferenceStore } from "../embedding/reference-store";
import { EMBED_DIM } from "../embedding/thresholds";
import { encodePack } from "./format";
import { ensurePack } from "./install";
import type { PackManifest } from "./manifest";

const unit = (axis: number) => {
  const v = new Array(EMBED_DIM).fill(0);
  v[axis] = 1;
  return normalize(v);
};
const manifest = (version = "v1"): PackManifest => ({
  version,
  model: "clip-vit-base-patch32",
  dim: 512,
  vectors: "vectors-0123abcd.bin",
  games: [
    { bggId: "1", name: "A", year: 2000, rank: 1, coverUrl: "https://x/a.jpg" },
    { bggId: "2", name: "B", year: 2001, rank: 2, coverUrl: "https://x/b.jpg" },
  ],
});
const body = encodePack([unit(1), unit(2)]);
const okFetch = () =>
  vi.fn<(url: string) => Promise<Response>>(
    async () => new Response(body as BodyInit, { status: 200 }),
  );
const asFetch = (f: ReturnType<typeof vi.fn>) => f as unknown as typeof fetch;

describe("ensurePack", () => {
  it("downloads the manifest's vectors file once and stores one entry per game", async () => {
    const store = await openReferenceStore(new IDBFactory());
    const fetchImpl = okFetch();
    const loadManifest = async () => manifest();
    const first = await ensurePack(store, {
      fetchImpl: asFetch(fetchImpl),
      loadManifest,
    });
    expect(first).toEqual({ installed: true, games: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "/reference-pack/vectors-0123abcd.bin",
    );
    expect((await store.all()).map((r) => r.gameId)).toEqual([
      "bgg:1",
      "bgg:2",
    ]);
    expect(await store.packVersion()).toBe("v1");

    await ensurePack(store, { fetchImpl: asFetch(fetchImpl), loadManifest });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // current: no request
  });

  it("a new manifest version replaces the stored pack", async () => {
    const store = await openReferenceStore(new IDBFactory());
    await ensurePack(store, {
      fetchImpl: asFetch(okFetch()),
      loadManifest: async () => manifest("v1"),
    });
    const fetchImpl = okFetch();
    await ensurePack(store, {
      fetchImpl: asFetch(fetchImpl),
      loadManifest: async () => manifest("v2"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await store.packVersion()).toBe("v2");
  });

  it("a truncated body keeps the previous pack and reports not installed", async () => {
    const store = await openReferenceStore(new IDBFactory());
    await ensurePack(store, {
      fetchImpl: asFetch(okFetch()),
      loadManifest: async () => manifest("v1"),
    });
    const truncated = vi.fn(
      async () => new Response(body.subarray(0, 100) as BodyInit),
    );
    const result = await ensurePack(store, {
      fetchImpl: asFetch(truncated),
      loadManifest: async () => manifest("v2"),
    });
    expect(result.installed).toBe(false);
    expect(await store.packVersion()).toBe("v1");
    expect(await store.all()).toHaveLength(2);
  });

  it("a 404 and a network error store nothing", async () => {
    for (const f of [
      vi.fn(async () => new Response(null, { status: 404 })),
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    ]) {
      const store = await openReferenceStore(new IDBFactory());
      const result = await ensurePack(store, {
        fetchImpl: asFetch(f),
        loadManifest: async () => manifest(),
      });
      expect(result).toEqual({ installed: false, games: 0 });
      expect(await store.all()).toEqual([]);
      expect(await store.packVersion()).toBeNull();
    }
  });

  it("an aborted download stores nothing", async () => {
    const store = await openReferenceStore(new IDBFactory());
    const controller = new AbortController();
    controller.abort();
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("x", "AbortError");
      return new Response(body as BodyInit);
    });
    const result = await ensurePack(store, {
      fetchImpl: asFetch(f),
      loadManifest: async () => manifest(),
      signal: controller.signal,
    });
    expect(result.installed).toBe(false);
    expect(await store.all()).toEqual([]);
  });

  it("a manifest that fails to load reports not installed without a request", async () => {
    const store = await openReferenceStore(new IDBFactory());
    const fetchImpl = okFetch();
    const result = await ensurePack(store, {
      fetchImpl: asFetch(fetchImpl),
      loadManifest: async () => {
        throw new Error("chunk failed");
      },
    });
    expect(result.installed).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
