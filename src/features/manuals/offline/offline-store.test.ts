import { describe, expect, it, vi } from "vitest";
import { FILE_PREFIX, META_PREFIX } from "./constants";
import { createOfflineStore, manualKey, type SaveInput } from "./offline-store";

// A tiny in-memory Cache Storage (the real one needs a browser).
class FakeCache {
  entries = new Map<string, Response>();
  failPut = false;
  private path = (r: Request | string) =>
    new URL(typeof r === "string" ? r : r.url, "https://amika.test").pathname;
  async put(request: Request | string, response: Response) {
    if (this.failPut) throw new DOMException("full", "QuotaExceededError");
    // read the body like a real cache does
    this.entries.set(
      this.path(request),
      new Response(await response.arrayBuffer(), response),
    );
  }
  async match(request: Request | string) {
    return this.entries.get(this.path(request))?.clone();
  }
  async delete(request: Request | string) {
    return this.entries.delete(this.path(request));
  }
  async keys() {
    return [...this.entries.keys()].map(
      (p) => new Request(`https://amika.test${p}`),
    );
  }
}

function fakeCaches(cache = new FakeCache()) {
  return {
    cache,
    caches: { open: async () => cache } as unknown as CacheStorage,
  };
}

const input: SaveInput = {
  url: "https://www.devir.com/rules/catan.pdf",
  gameId: "g1",
  gameName: "Catan",
  title: "Catan reglamento",
  locale: "es",
  publisher: "Devir",
  source: "/api/manuals/file?resource=r1",
};

const pdf = (headers: Record<string, string> = {}, status = 200) =>
  new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]), {
    status,
    headers: {
      "content-type": "application/pdf",
      "content-length": "8",
      ...headers,
    },
  });

const NOW = () => new Date("2026-11-18T10:00:00Z");

describe("offline store", () => {
  it("manualKey is stable and distinguishes URLs", async () => {
    expect(await manualKey("https://a.example/x.pdf")).toBe(
      await manualKey("https://a.example/x.pdf"),
    );
    expect(await manualKey("https://a.example/x.pdf")).not.toBe(
      await manualKey("https://a.example/y.pdf"),
    );
    expect(await manualKey("https://a.example/x.pdf")).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });

  it("saves the PDF without a download header, plus its description", async () => {
    const { cache, caches } = fakeCaches();
    const fetchImpl = vi.fn(async () =>
      pdf({ "content-disposition": 'attachment; filename="x.pdf"' }),
    );
    const store = createOfflineStore({
      caches,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: NOW,
    });

    const result = await store.save(input);
    if (!result.ok) throw new Error("expected ok");
    expect(result.saved).toMatchObject({
      gameName: "Catan",
      sizeBytes: 8,
      savedAt: "2026-11-18T10:00:00.000Z",
    });

    const file = await cache.match(`${FILE_PREFIX}${result.saved.key}`);
    expect(file?.headers.get("content-type")).toBe("application/pdf");
    expect(file?.headers.get("content-disposition")).toBeNull(); // would force a download on open
    expect((await file!.arrayBuffer()).byteLength).toBe(8);
    expect(
      await cache.match(`${META_PREFIX}${result.saved.key}`),
    ).toBeDefined();
    expect(fetchImpl).toHaveBeenCalledWith(input.source, {
      credentials: "same-origin",
    });
  });

  it("has / list / remove", async () => {
    const { cache, caches } = fakeCaches();
    const store = createOfflineStore({
      caches,
      fetchImpl: (async () => pdf()) as unknown as typeof fetch,
      now: NOW,
    });
    expect(await store.has(input.url)).toBe(false);
    await store.save(input);
    await store.save({
      ...input,
      url: "https://b.example/y.pdf",
      title: "Other",
    });
    expect(await store.has(input.url)).toBe(true);
    expect((await store.list()).map((m) => m.title).sort()).toEqual([
      "Catan reglamento",
      "Other",
    ]);

    await store.remove(input.url);
    expect(await store.has(input.url)).toBe(false);
    expect(await store.list()).toHaveLength(1);
    expect(
      [...cache.entries.keys()].filter((p) => p.startsWith(FILE_PREFIX)),
    ).toHaveLength(1);
  });

  it("refuses up front when the declared size does not fit, storing nothing", async () => {
    const { cache, caches } = fakeCaches();
    const store = createOfflineStore({
      caches,
      fetchImpl: (async () =>
        pdf({ "content-length": "5000" })) as unknown as typeof fetch,
      storage: {
        estimate: async () => ({ usage: 900, quota: 1000 }),
        persist: async () => true,
      },
    });
    expect(await store.save(input)).toEqual({ ok: false, error: "quota" });
    expect(cache.entries.size).toBe(0);
  });

  it("cleans up when the browser runs out of room mid-write", async () => {
    const { cache, caches } = fakeCaches();
    cache.failPut = true;
    const store = createOfflineStore({
      caches,
      fetchImpl: (async () => pdf()) as unknown as typeof fetch,
    });
    expect(await store.save(input)).toEqual({ ok: false, error: "quota" });
    expect(cache.entries.size).toBe(0);
  });

  it.each([
    [413, "too_large"],
    [429, "rate_limited"],
    [404, "network"],
    [502, "network"],
  ] as const)("maps HTTP %i to %s", async (status, error) => {
    const { caches } = fakeCaches();
    const store = createOfflineStore({
      caches,
      fetchImpl: (async () =>
        new Response(null, { status })) as unknown as typeof fetch,
    });
    expect(await store.save(input)).toEqual({ ok: false, error });
  });

  it("reports a network failure", async () => {
    const { caches } = fakeCaches();
    const store = createOfflineStore({
      caches,
      fetchImpl: (async () => {
        throw new TypeError("offline");
      }) as unknown as typeof fetch,
    });
    expect(await store.save(input)).toEqual({ ok: false, error: "network" });
  });

  it("degrades quietly where Cache Storage does not exist", async () => {
    const store = createOfflineStore({ caches: undefined, storage: undefined });
    // `caches` is also undefined in the node test environment
    expect(store.isSupported()).toBe(false);
    expect(await store.save(input)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(await store.list()).toEqual([]);
    expect(await store.has(input.url)).toBe(false);
  });

  it("asks the browser to keep the data, best effort", async () => {
    const { caches } = fakeCaches();
    const persist = vi.fn(async () => true);
    const store = createOfflineStore({
      caches,
      fetchImpl: (async () => pdf()) as unknown as typeof fetch,
      storage: { estimate: async () => ({ usage: 0, quota: 1e9 }), persist },
    });
    await store.save(input);
    expect(persist).toHaveBeenCalled();
  });
});
