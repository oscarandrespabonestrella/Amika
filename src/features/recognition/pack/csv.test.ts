import { describe, expect, it } from "vitest";
import { parseRanksCsv } from "./csv";

const HEADER =
  "ID,Name,Year,Rank,Average,Bayes average,Users rated,URL,Thumbnail";
const row = (id: string, name: string, year: string, rank: string) =>
  `${id},${name},${year},${rank},8.1,7.9,1000,/boardgame/${id}/x,https://cf.geekdo-images.com/t.jpg`;

describe("parseRanksCsv", () => {
  it("returns the top rows sorted by rank, whatever the file order", () => {
    const text = [
      HEADER,
      row("2", "Ark Nova", "2021", "2"),
      row("1", "Brass: Birmingham", "2018", "1"),
      row("3", "Pandemic Legacy: Season 1", "2015", "3"),
    ].join("\n");
    expect(parseRanksCsv(text, 2)).toEqual([
      { bggId: "1", name: "Brass: Birmingham", year: 2018, rank: 1 },
      { bggId: "2", name: "Ark Nova", year: 2021, rank: 2 },
    ]);
  });

  it("handles quoted names with commas and escaped quotes", () => {
    const text = [
      HEADER,
      row("10", '"Dune, Imperium"', "2020", "1"),
      row("11", '"The ""Best"" Game"', "2019", "2"),
    ].join("\n");
    expect(parseRanksCsv(text, 5).map((r) => r.name)).toEqual([
      "Dune, Imperium",
      'The "Best" Game',
    ]);
  });

  it("drops rows without a ranking (empty or 0) or without a numeric id", () => {
    const text = [
      HEADER,
      row("1", "A", "2000", ""),
      row("2", "B", "2000", "0"),
      row("x", "C", "2000", "3"),
      row("4", "D", "2000", "4"),
    ].join("\n");
    expect(parseRanksCsv(text, 10).map((r) => r.bggId)).toEqual(["4"]);
  });

  it("accepts CRLF and keeps a missing or zero year as null", () => {
    const text = [HEADER, row("5", "E", "0", "1"), row("6", "F", "", "2")].join(
      "\r\n",
    );
    expect(parseRanksCsv(text, 5).map((r) => r.year)).toEqual([null, null]);
  });

  it("returns [] for a header-only file, an empty file or a count of 0", () => {
    expect(parseRanksCsv(HEADER, 5)).toEqual([]);
    expect(parseRanksCsv("", 5)).toEqual([]);
    expect(
      parseRanksCsv([HEADER, row("1", "A", "2000", "1")].join("\n"), 0),
    ).toEqual([]);
  });
});
