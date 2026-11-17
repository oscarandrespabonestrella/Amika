import { describe, expect, it } from "vitest";
import {
  getPackManifest,
  packCoverUrl,
  packGameInfo,
  packManifestSchema,
} from "./manifest";

describe("pack manifest", () => {
  it("the committed manifest is valid and has unique BGG ids in rank order", () => {
    const m = getPackManifest();
    expect(m.model).toBe("clip-vit-base-patch32");
    expect(m.dim).toBe(512);
    expect(m.vectors).toMatch(/^vectors-[0-9a-f]{8}\.bin$/);
    const ids = m.games.map((g) => g.bggId);
    expect(new Set(ids).size).toBe(ids.length);
    const ranks = m.games.map((g) => g.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("packCoverUrl answers for pack ids only, never for object-prototype keys", () => {
    const first = getPackManifest().games[0];
    expect(packCoverUrl(first.bggId)).toBe(first.coverUrl);
    for (const id of ["999999999", "__proto__", "constructor", "toString", ""])
      expect(packCoverUrl(id), id).toBeNull();
  });

  it("the schema rejects a non-https cover, a wrong dimension and a path-like vectors name", () => {
    const base = {
      version: "1",
      model: "clip-vit-base-patch32",
      dim: 512,
      vectors: "vectors-0123abcd.bin",
      games: [
        {
          bggId: "1",
          name: "A",
          year: 2000,
          rank: 1,
          coverUrl: "https://cf.geekdo-images.com/a.jpg",
        },
      ],
    };
    expect(packManifestSchema.safeParse(base).success).toBe(true);
    expect(
      packManifestSchema.safeParse({
        ...base,
        games: [
          { ...base.games[0], coverUrl: "http://cf.geekdo-images.com/a.jpg" },
        ],
      }).success,
    ).toBe(false);
    expect(packManifestSchema.safeParse({ ...base, dim: 256 }).success).toBe(
      false,
    );
    expect(
      packManifestSchema.safeParse({ ...base, vectors: "../secret.bin" })
        .success,
    ).toBe(false);
  });
});

describe("packGameInfo", () => {
  it("describes a pack id (name and BGG rank) and nothing else", () => {
    const first = getPackManifest().games[0];
    expect(packGameInfo(`bgg:${first.bggId}`)).toEqual({
      bggId: first.bggId,
      name: first.name,
      rank: first.rank,
    });
    for (const id of [
      "bgg:999999999",
      `${first.bggId}`,
      "bgg:__proto__",
      "00000000-0000-4000-8000-0000000000a1",
      "",
    ])
      expect(packGameInfo(id), id).toBeNull();
  });
});
