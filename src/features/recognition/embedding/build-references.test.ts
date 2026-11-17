import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { buildReferences } from "./build-references";
import { normalize } from "./rank";
import { openReferenceStore } from "./reference-store";
import { EMBED_DIM } from "./thresholds";

const vec = (axis: number) => {
  const v = new Array(EMBED_DIM).fill(0);
  v[axis % EMBED_DIM] = 1;
  return normalize(v);
};
const game = (n: number, coverUrl: string | null = `https://c/${n}.jpg`) => ({
  id: `g${n}`,
  coverUrl,
});
const fresh = () => openReferenceStore(new IDBFactory());

describe("buildReferences", () => {
  it("embeds every new cover once and reports progress 1..N", async () => {
    const store = await fresh();
    const embedCover = vi.fn(async (id: string) => vec(Number(id.slice(1))));
    const progress: [number, number][] = [];
    const result = await buildReferences({
      games: [game(1), game(2), game(3)],
      store,
      embedCover,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(result).toEqual({ built: 3, skipped: 0, failed: [] });
    expect(embedCover).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect((await store.all()).map((r) => r.gameId).sort()).toEqual([
      "g1",
      "g2",
      "g3",
    ]);
  });

  it("skips covers whose stored URL is unchanged, re-embeds a changed one", async () => {
    const store = await fresh();
    const embedCover = vi.fn(async (id: string) => vec(Number(id.slice(1))));
    await buildReferences({ games: [game(1), game(2)], store, embedCover });
    embedCover.mockClear();

    const again = await buildReferences({
      games: [game(1), { id: "g2", coverUrl: "https://c/2-new.jpg" }],
      store,
      embedCover,
    });
    expect(again).toEqual({ built: 1, skipped: 1, failed: [] });
    expect(embedCover).toHaveBeenCalledTimes(1);
    expect(embedCover).toHaveBeenCalledWith("g2");
    expect((await store.getCover("g2"))?.coverUrl).toBe("https://c/2-new.jpg");
  });

  it("skips a game without a cover", async () => {
    const store = await fresh();
    const embedCover = vi.fn(async () => vec(1));
    const result = await buildReferences({
      games: [game(1, null), game(2)],
      store,
      embedCover,
    });
    expect(result).toEqual({ built: 1, skipped: 1, failed: [] });
    expect(embedCover).toHaveBeenCalledTimes(1);
  });

  it("collects a failing cover and carries on with the rest", async () => {
    const store = await fresh();
    const embedCover = vi.fn(async (id: string) => {
      if (id === "g2") throw new Error("404");
      return vec(1);
    });
    const result = await buildReferences({
      games: [game(1), game(2), game(3)],
      store,
      embedCover,
    });
    expect(result).toEqual({ built: 2, skipped: 0, failed: ["g2"] });
    expect(await store.getCover("g2")).toBeUndefined();
  });

  it("stops before the next game when aborted, keeping what was built", async () => {
    const store = await fresh();
    const ctl = new AbortController();
    const embedCover = vi.fn(async (id: string) => {
      if (id === "g2") ctl.abort();
      return vec(1);
    });
    const result = await buildReferences({
      games: [game(1), game(2), game(3), game(4)],
      store,
      embedCover,
      signal: ctl.signal,
    });
    expect(embedCover).toHaveBeenCalledTimes(2);
    expect(result.built).toBe(2);
    expect((await store.all()).map((r) => r.gameId).sort()).toEqual([
      "g1",
      "g2",
    ]);
  });

  it("an already-aborted signal embeds nothing", async () => {
    const store = await fresh();
    const ctl = new AbortController();
    ctl.abort();
    const embedCover = vi.fn(async () => vec(1));
    const result = await buildReferences({
      games: [game(1)],
      store,
      embedCover,
      signal: ctl.signal,
    });
    expect(embedCover).not.toHaveBeenCalled();
    expect(result.built).toBe(0);
  });

  it("purges the references of games no longer in the catalog (covers and learned)", async () => {
    const store = await fresh();
    await store.putCover("gone", "u", vec(1));
    await store.addLearned("gone", vec(2));
    await store.putCover("g1", "https://c/1.jpg", vec(3));
    const embedCover = vi.fn(async () => vec(4));
    await buildReferences({ games: [game(1)], store, embedCover });
    expect((await store.all()).map((r) => r.gameId)).toEqual(["g1"]);
  });

  it("does not purge anything when the game list is incomplete (purge: false)", async () => {
    const store = await fresh();
    await store.putCover("beyond-the-cap", "u", vec(1));
    await store.addLearned("beyond-the-cap", vec(2));
    await buildReferences({
      games: [game(1)],
      store,
      embedCover: async () => vec(4),
      purge: false,
    });
    expect((await store.all()).map((r) => r.gameId).sort()).toEqual([
      "beyond-the-cap",
      "beyond-the-cap",
      "g1",
    ]);
  });

  it("never purges the pack entries (bgg:<id>) of the reference pack", async () => {
    const store = await fresh();
    await store.putPack([{ gameId: "bgg:224517", vec: vec(7) }], "v1");
    await store.putCover("gone", "u", vec(1));
    await buildReferences({
      games: [game(1)],
      store,
      embedCover: async () => vec(4),
    });
    expect((await store.all()).map((r) => r.gameId).sort()).toEqual([
      "bgg:224517",
      "g1",
    ]);
  });

  it("keeps the learned vectors of games that stay", async () => {
    const store = await fresh();
    await store.addLearned("g1", vec(9));
    await buildReferences({
      games: [game(1)],
      store,
      embedCover: async () => vec(1),
    });
    expect(
      (await store.all()).filter((r) => r.kind === "learned"),
    ).toHaveLength(1);
  });

  it("builds 50 games with a stub embedder in well under a second", async () => {
    const store = await fresh();
    const started = Date.now();
    const result = await buildReferences({
      games: Array.from({ length: 50 }, (_, i) => game(i + 1)),
      store,
      embedCover: async (id) => vec(Number(id.slice(1))),
    });
    expect(result.built).toBe(50);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
