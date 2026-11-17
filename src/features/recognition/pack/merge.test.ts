import { describe, expect, it } from "vitest";
import { normalize, type Reference } from "../embedding/rank";
import { EMBED_DIM } from "../embedding/thresholds";
import { mergeReferences } from "./merge";

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
