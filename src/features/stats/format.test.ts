import { describe, expect, it } from "vitest";
import {
  pivotSeries,
  topSeriesPlayers,
  winRate,
  type PlayerStat,
  type SeriesPoint,
} from "./format";

const stat = (
  playerId: string,
  name: string,
  plays: number,
  wins = 0,
): PlayerStat => ({
  playerId,
  name,
  plays,
  scoredPlays: plays,
  wins,
  avgScore: null,
  bestScore: null,
});

const point = (
  seq: number,
  playerId: string,
  total: number,
  playedOn = "2026-01-01",
): SeriesPoint => ({
  playId: `play-${seq}`,
  seq,
  playedOn,
  playerId,
  name: playerId.toUpperCase(),
  total,
});

describe("winRate", () => {
  it("is wins over scored matches", () => {
    expect(winRate(3, 4)).toBe(0.75);
    expect(winRate(1, 1)).toBe(1);
    expect(winRate(0, 3)).toBe(0);
  });

  it("is null (never NaN) when nothing was scored", () => {
    expect(winRate(0, 0)).toBeNull();
  });
});

describe("topSeriesPlayers", () => {
  it("returns the 5 most frequent players, most plays first", () => {
    const players = [
      stat("a", "Ana", 1),
      stat("b", "Bo", 7),
      stat("c", "Cy", 3),
      stat("d", "Dee", 9),
      stat("e", "Eli", 2),
      stat("f", "Fay", 5),
      stat("g", "Gus", 4),
    ];
    expect(topSeriesPlayers(players)).toEqual(["d", "b", "f", "g", "c"]);
  });

  it("breaks ties by name, then by id, and is stable", () => {
    const players = [
      stat("z", "Ana", 2),
      stat("y", "Ana", 2),
      stat("x", "Bo", 2),
    ];
    expect(topSeriesPlayers(players)).toEqual(["y", "z", "x"]);
  });

  it("returns fewer when there are fewer, and [] for nobody", () => {
    expect(topSeriesPlayers([stat("a", "Ana", 1)])).toEqual(["a"]);
    expect(topSeriesPlayers([])).toEqual([]);
  });

  it("honors a custom max", () => {
    expect(topSeriesPlayers([stat("a", "A", 3), stat("b", "B", 2)], 1)).toEqual(
      ["a"],
    );
  });
});

describe("pivotSeries", () => {
  it("makes one row per match number with null where a player has no score", () => {
    const rows = pivotSeries(
      [
        point(1, "a", 10, "2026-01-01"),
        point(1, "b", 4, "2026-01-01"),
        point(2, "a", 8, "2026-01-02"),
        point(3, "b", 6, "2026-01-03"),
      ],
      ["a", "b"],
    );
    expect(rows).toEqual([
      { seq: 1, playedOn: "2026-01-01", a: 10, b: 4 },
      { seq: 2, playedOn: "2026-01-02", a: 8, b: null },
      { seq: 3, playedOn: "2026-01-03", a: null, b: 6 },
    ]);
  });

  it("drops players that are not listed, keeps negatives and zero", () => {
    const rows = pivotSeries(
      [point(1, "a", -5), point(1, "b", 0), point(1, "c", 99)],
      ["a", "b"],
    );
    expect(rows).toEqual([{ seq: 1, playedOn: "2026-01-01", a: -5, b: 0 }]);
  });

  it("a match whose only scorers are unlisted still keeps its place on the axis", () => {
    const rows = pivotSeries(
      [point(1, "a", 3), point(2, "c", 9), point(3, "a", 4)],
      ["a"],
    );
    expect(rows.map((r) => [r.seq, r.a])).toEqual([
      [1, 3],
      [2, null],
      [3, 4],
    ]);
  });

  it("orders by seq whatever the input order, and handles no points", () => {
    expect(
      pivotSeries([point(2, "a", 1), point(1, "a", 2)], ["a"]).map(
        (r) => r.seq,
      ),
    ).toEqual([1, 2]);
    expect(pivotSeries([], ["a"])).toEqual([]);
  });
});
