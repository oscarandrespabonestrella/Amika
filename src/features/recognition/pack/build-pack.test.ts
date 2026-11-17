import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalize } from "../embedding/rank";
import { EMBED_DIM } from "../embedding/thresholds";
import { buildPack, type PackEntry } from "./build-pack";
import { decodePack } from "./format";
import { packManifestSchema } from "./manifest";

const unit = (axis: number) => {
  const v = new Array(EMBED_DIM).fill(0);
  v[axis] = 1;
  return normalize(v);
};
const entry = (
  rank: number,
  over: Partial<Omit<PackEntry, "row">> = {},
): PackEntry => ({
  row: {
    bggId: String(rank * 10),
    name: `Game ${rank}`,
    year: 2000 + rank,
    rank,
  },
  coverUrl: `https://cf.geekdo-images.com/g${rank}.jpg`,
  vec: unit(rank),
  ...over,
});

describe("buildPack", () => {
  it("keeps the given (rank) order and aligns each vector with its manifest game", () => {
    const { manifest, bytes } = buildPack([entry(1), entry(2), entry(3)]);
    expect(manifest.games.map((g) => g.rank)).toEqual([1, 2, 3]);
    const vecs = decodePack(bytes, manifest.games.length);
    vecs.forEach((v, i) => expect(v[manifest.games[i].rank]).toBeCloseTo(1, 6));
  });

  it("reports entries without a cover or a vector as skipped, and leaves them out of both files", () => {
    const { manifest, bytes, skipped } = buildPack([
      entry(1),
      entry(2, { coverUrl: null }),
      entry(3, { vec: null }),
      entry(4),
    ]);
    expect(manifest.games.map((g) => g.bggId)).toEqual(["10", "40"]);
    expect(bytes.byteLength).toBe(2 * EMBED_DIM * 4);
    expect(skipped).toEqual([
      { bggId: "20", name: "Game 2", reason: "no cover" },
      { bggId: "30", name: "Game 3", reason: "no vector" },
    ]);
  });

  it("names the vectors file after the first 8 hex chars of the SHA-256 of its bytes, and uses it as the version", () => {
    const { manifest, bytes } = buildPack([entry(1), entry(2)]);
    const hash8 = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    expect(manifest.vectors).toBe(`vectors-${hash8}.bin`);
    expect(manifest.version).toBe(hash8);
  });

  it("produces a manifest the app accepts", () => {
    const { manifest } = buildPack([entry(1), entry(2)]);
    expect(packManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.model).toBe("clip-vit-base-patch32");
    expect(manifest.dim).toBe(512);
  });

  it("refuses an empty pack (nothing usable) instead of writing one", () => {
    expect(() => buildPack([])).toThrow(/empty/i);
    expect(() => buildPack([entry(1, { coverUrl: null })])).toThrow(/empty/i);
  });
});
