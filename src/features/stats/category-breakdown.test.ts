import { describe, expect, it } from "vitest";
import { definitionSchema } from "@/features/scoring/engine/definition";
import { categoryAverages, type BreakdownPlay } from "./category-breakdown";

const SHEET = definitionSchema.parse({
  schemaVersion: 1,
  categories: [
    { key: "wonders", label: "Wonders", type: "number" },
    { key: "coins", label: "Coins", type: "per_n", n: 3, pointsPer: 1 },
    { key: "note", label: "Note", type: "number", scoring: false },
  ],
});

const player = (
  playerId: string,
  name: string,
  values: Record<string, number>,
  total: number | null = 1,
) => ({ playerId, name, total, values });

const play = (
  versionId: string,
  playedOn: string,
  participants: BreakdownPlay["participants"],
  definition: unknown = SHEET,
): BreakdownPlay => ({ versionId, playedOn, definition, participants });

describe("categoryAverages", () => {
  const plays = [
    play("v1", "2026-01-01", [
      player("a", "Ana", { wonders: 10, coins: 6 }), // 10 + 2
      player("b", "Bo", { wonders: 4, coins: 3 }), // 4 + 1
    ]),
    play("v1", "2026-01-02", [
      player("a", "Ana", { wonders: 6, coins: 9 }), // 6 + 3
      player("b", "Bo", { wonders: 8, coins: 0 }), // 8 + 0
    ]),
    play("v1", "2026-01-03", [
      player("a", "Ana", { wonders: 5 }), // a missing value is 0 points
    ]),
  ];

  it("averages the points (not the raw inputs) of each scoring category per player", () => {
    const result = categoryAverages(plays)!;
    expect(result.versionId).toBe("v1");
    expect(result.categories).toEqual([
      { key: "wonders", label: "Wonders" },
      { key: "coins", label: "Coins" },
    ]);
    const ana = result.rows.find((r) => r.playerId === "a")!;
    expect(ana.matches).toBe(3);
    expect(ana.averages.wonders).toBeCloseTo(7, 10); // (10 + 6 + 5) / 3
    expect(ana.averages.coins).toBeCloseTo(5 / 3, 10); // (2 + 3 + 0) / 3
    const bo = result.rows.find((r) => r.playerId === "b")!;
    expect(bo.matches).toBe(2);
    expect(bo.averages).toEqual({ wonders: 6, coins: 0.5 });
    expect(result.used).toBe(3);
    expect(result.skipped).toBe(0);
  });

  it("leaves out categories that do not score (informative ones)", () => {
    const keys = categoryAverages(plays)!.categories.map((c) => c.key);
    expect(keys).not.toContain("note");
  });

  it("uses the sheet version most matches used and counts the rest as skipped", () => {
    const result = categoryAverages([
      ...plays,
      play("v2", "2026-02-01", [player("a", "Ana", { wonders: 99 })]),
    ])!;
    expect(result.versionId).toBe("v1");
    expect(result.used).toBe(3);
    expect(result.skipped).toBe(1);
  });

  it("on a tie in matches, the version played most recently wins", () => {
    const result = categoryAverages([
      play("old", "2026-01-01", [player("a", "Ana", { wonders: 1 })]),
      play("new", "2026-03-01", [player("a", "Ana", { wonders: 2 })]),
    ])!;
    expect(result.versionId).toBe("new");
    expect(result.skipped).toBe(1);
  });

  it("ignores participants with no recorded total (they have no points to average)", () => {
    const result = categoryAverages([
      play("v1", "2026-01-01", [
        player("a", "Ana", { wonders: 10 }),
        player("b", "Bo", {}, null),
      ]),
    ])!;
    expect(result.rows.map((r) => r.playerId)).toEqual(["a"]);
  });

  it("is null, never throws, for an invalid stored definition, no matches or garbage", () => {
    expect(categoryAverages([])).toBeNull();
    expect(
      categoryAverages([
        play("v1", "2026-01-01", [player("a", "Ana", { wonders: 1 })], {
          nonsense: true,
        }),
      ]),
    ).toBeNull();
    expect(
      categoryAverages([
        play("v1", "2026-01-01", [player("a", "Ana", { wonders: 1 })], null),
      ]),
    ).toBeNull();
  });

  it("orders players by number of matches, then name", () => {
    const result = categoryAverages(plays)!;
    expect(result.rows.map((r) => r.name)).toEqual(["Ana", "Bo"]);
  });
});
