import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { normalize } from "./rank";
import { openReferenceStore } from "./reference-store";
import { EMBED_DIM } from "./thresholds";

const vec = (axis: number) => {
  const v = new Array(EMBED_DIM).fill(0);
  v[axis] = 1;
  return normalize(v);
};

describe("openReferenceStore (IndexedDB)", () => {
  it("round-trips a cover vector exactly and is persistent", async () => {
    const store = await openReferenceStore(new IDBFactory());
    expect(store.persistent).toBe(true);
    await store.putCover("g1", "https://c/1.jpg", vec(3));
    const got = await store.getCover("g1");
    expect(got?.coverUrl).toBe("https://c/1.jpg");
    expect(got?.vec).toBeInstanceOf(Float32Array);
    expect(Array.from(got!.vec)).toEqual(Array.from(vec(3)));
    expect(await store.getCover("missing")).toBeUndefined();
  });

  it("all() lists covers and learned vectors as references", async () => {
    const store = await openReferenceStore(new IDBFactory());
    await store.putCover("g1", "u1", vec(1));
    await store.addLearned("g1", vec(2));
    await store.putCover("g2", "u2", vec(3));
    const refs = await store.all();
    expect(refs.map((r) => `${r.gameId}:${r.kind}`).sort()).toEqual([
      "g1:cover",
      "g1:learned",
      "g2:cover",
    ]);
  });

  it("putCover replaces the previous cover vector of the game", async () => {
    const store = await openReferenceStore(new IDBFactory());
    await store.putCover("g1", "old", vec(1));
    await store.putCover("g1", "new", vec(2));
    expect((await store.getCover("g1"))?.coverUrl).toBe("new");
    expect((await store.all()).filter((r) => r.kind === "cover")).toHaveLength(
      1,
    );
  });

  it("keeps at most 3 learned vectors per game, dropping the oldest", async () => {
    const store = await openReferenceStore(new IDBFactory());
    for (const axis of [10, 11, 12, 13, 14])
      await store.addLearned("g1", vec(axis));
    const learned = (await store.all()).filter((r) => r.kind === "learned");
    expect(learned).toHaveLength(3);
    const axes = learned.map((r) => r.vec.indexOf(1)).sort();
    expect(axes).toEqual([12, 13, 14]);
  });

  it("remove() drops every vector of one game; clear() drops all", async () => {
    const store = await openReferenceStore(new IDBFactory());
    await store.putCover("g1", "u", vec(1));
    await store.addLearned("g1", vec(2));
    await store.putCover("g2", "u", vec(3));
    await store.remove("g1");
    expect((await store.all()).map((r) => r.gameId)).toEqual(["g2"]);
    await store.clear();
    expect(await store.all()).toEqual([]);
  });

  it("a second store on the same database sees what the first saved", async () => {
    const factory = new IDBFactory();
    const a = await openReferenceStore(factory);
    await a.putCover("g1", "u", vec(7));
    const b = await openReferenceStore(factory);
    expect((await b.getCover("g1"))?.vec[7]).toBe(1);
  });
});

describe("fallback to memory", () => {
  const memoryWorks = async (
    store: Awaited<ReturnType<typeof openReferenceStore>>,
  ) => {
    expect(store.persistent).toBe(false);
    await store.putCover("g1", "u", vec(1));
    await store.addLearned("g1", vec(2));
    expect((await store.all()).map((r) => r.kind).sort()).toEqual([
      "cover",
      "learned",
    ]);
    await store.remove("g1");
    expect(await store.all()).toEqual([]);
  };

  it("when IndexedDB does not exist", async () => {
    await memoryWorks(await openReferenceStore(undefined));
  });

  it("when opening it throws (private mode, blocked storage)", async () => {
    const broken = {
      open() {
        throw new Error("SecurityError");
      },
    } as unknown as IDBFactory;
    await memoryWorks(await openReferenceStore(broken));
  });

  it("when opening it errors asynchronously", async () => {
    const failing = {
      open() {
        const req: { onerror?: () => void; error: Error } = {
          error: new Error("denied"),
        };
        queueMicrotask(() => req.onerror?.());
        return req;
      },
    } as unknown as IDBFactory;
    await memoryWorks(await openReferenceStore(failing));
  });
});

describe("pack rows", () => {
  it("putPack replaces the whole previous pack and leaves covers and learned vectors alone", async () => {
    const store = await openReferenceStore(new IDBFactory());
    await store.putCover("g1", "u1", vec(1));
    await store.addLearned("g1", vec(2));
    await store.putPack(
      [
        { gameId: "bgg:1", vec: vec(3) },
        { gameId: "bgg:2", vec: vec(4) },
      ],
      "v1",
    );
    await store.putPack([{ gameId: "bgg:3", vec: vec(5) }], "v2");
    const refs = await store.all();
    expect(refs.filter((r) => r.kind === "pack").map((r) => r.gameId)).toEqual([
      "bgg:3",
    ]);
    expect(refs.filter((r) => r.kind !== "pack")).toHaveLength(2);
  });

  it("packVersion round-trips, is null before any pack, and never shows up in all()", async () => {
    const factory = new IDBFactory();
    const store = await openReferenceStore(factory);
    expect(await store.packVersion()).toBeNull();
    await store.putPack([{ gameId: "bgg:1", vec: vec(3) }], "v1");
    expect(await (await openReferenceStore(factory)).packVersion()).toBe("v1");
    expect((await store.all()).map((r) => r.gameId)).toEqual(["bgg:1"]);
  });

  it("clear() removes the pack and its version", async () => {
    const store = await openReferenceStore(new IDBFactory());
    await store.putPack([{ gameId: "bgg:1", vec: vec(3) }], "v1");
    await store.clear();
    expect(await store.all()).toEqual([]);
    expect(await store.packVersion()).toBeNull();
  });

  it("works the same on the in-memory fallback", async () => {
    const store = await openReferenceStore(undefined);
    expect(store.persistent).toBe(false);
    await store.putPack([{ gameId: "bgg:1", vec: vec(3) }], "v1");
    await store.putPack([{ gameId: "bgg:2", vec: vec(4) }], "v2");
    expect((await store.all()).map((r) => r.gameId)).toEqual(["bgg:2"]);
    expect(await store.packVersion()).toBe("v2");
  });
});
