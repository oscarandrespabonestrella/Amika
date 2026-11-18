import { describe, expect, it } from "vitest";
import { buildQueries } from "./query";
import type { GameIdentity } from "./types";

const game: GameIdentity = {
  id: "g1",
  name: "Catan",
  altNames: ["Die Siedler von Catan"],
  year: 1995,
  publishers: ["Devir", "Kosmos"],
  relatedNames: [],
  isExpansion: false,
};

describe("buildQueries", () => {
  it("makes one PDF query per language, in priority order", () => {
    const qs = buildQueries({ ...game, publishers: [] });
    expect(qs.map((q) => q.locale)).toEqual(["es", "en", "fr", "de"]);
    expect(qs[0].q).toBe('"Catan" reglamento filetype:pdf');
    expect(qs[1].q).toBe('"Catan" rulebook filetype:pdf');
    expect(qs.every((q) => !q.official)).toBe(true);
  });

  it("adds one site-restricted query when the publisher is known", () => {
    const qs = buildQueries(game);
    const official = qs.filter((q) => q.official);
    expect(official).toHaveLength(1);
    expect(official[0].q).toContain("site:devir.com");
    expect(official[0].q).toContain("site:kosmos.de");
  });

  it("skips the site query for an unknown publisher", () => {
    expect(
      buildQueries({ ...game, publishers: ["Editorial Desconocida"] }),
    ).toHaveLength(4);
  });

  it("cannot be broken out of its quotes by the game name", () => {
    const [first] = buildQueries({
      ...game,
      name: 'Evil" site:attacker.com "',
      publishers: [],
    });
    expect(first.q.match(/"/g)).toHaveLength(2);
  });
});
