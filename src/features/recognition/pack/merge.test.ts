import { describe, expect, it } from "vitest";
import { normalize, type Reference } from "../embedding/rank";
import { EMBED_DIM } from "../embedding/thresholds";
import { assembleReferences, mergeReferences } from "./merge";

const v = normalize(
  new Array(EMBED_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
);
const ref = (gameId: string, kind: Reference["kind"]): Reference => ({
  gameId,
  vec: v,
  kind,
});

describe("mergeReferences", () => {
  it("hides the pack entry of a BGG game that is in the catalog (the catalog wins)", () => {
    const catalog = [ref("uuid-13", "cover"), ref("uuid-13", "learned")];
    const pack = [ref("bgg:13", "pack"), ref("bgg:14", "pack")];
    const merged = mergeReferences(catalog, pack, new Set(["13"]));
    expect(merged.map((r) => r.gameId)).toEqual([
      "uuid-13",
      "uuid-13",
      "bgg:14",
    ]);
  });

  it("returns the pack untouched when the catalog has no BGG games", () => {
    const pack = [ref("bgg:1", "pack"), ref("bgg:2", "pack")];
    expect(mergeReferences([], pack, new Set())).toEqual(pack);
  });

  it("brings the pack entry back when the game leaves the catalog", () => {
    const pack = [ref("bgg:13", "pack")];
    expect(mergeReferences([], pack, new Set(["13"]))).toEqual([]);
    expect(mergeReferences([], pack, new Set())).toHaveLength(1);
  });
});

describe("assembleReferences", () => {
  it("splits the store's single list into catalog and pack and applies the catalog-wins rule", () => {
    const all = [
      ref("uuid-13", "cover"),
      ref("uuid-13", "learned"),
      ref("bgg:13", "pack"),
      ref("bgg:14", "pack"),
    ];
    const out = assembleReferences(all, [{ bggId: "13" }, { bggId: null }]);
    expect(out.map((r) => r.gameId)).toEqual(["uuid-13", "uuid-13", "bgg:14"]);
  });

  it("keeps every pack entry when no catalog game has a BGG id", () => {
    const all = [ref("bgg:1", "pack"), ref("uuid-x", "cover")];
    expect(assembleReferences(all, [{ bggId: null }])).toHaveLength(2);
  });
});

describe("assembleReferences without a usable pack", () => {
  it("drops the stored pack rows when the pack cannot be named (includePack: false)", () => {
    const all = [
      ref("uuid-1", "cover"),
      ref("bgg:9", "pack"),
      ref("uuid-1", "learned"),
    ];
    const out = assembleReferences(all, [{ bggId: null }], {
      includePack: false,
    });
    expect(out.map((r) => r.gameId)).toEqual(["uuid-1", "uuid-1"]);
  });

  it("keeps them by default", () => {
    const all = [ref("bgg:9", "pack")];
    expect(assembleReferences(all, [])).toHaveLength(1);
  });
});
