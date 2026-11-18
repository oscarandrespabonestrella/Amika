import { describe, expect, it } from "vitest";
import { parseBggCollectionCsv } from "./bgg-collection";

const HEADER = "objectname,objectid,rating,own,prevowned,wishlist,itemtype";
const parse = (...lines: string[]) =>
  parseBggCollectionCsv([HEADER, ...lines].join("\n"));

describe("parseBggCollectionCsv", () => {
  it("maps own / prevowned to a status and rounds the rating", () => {
    const result = parse(
      '"7 Wonders","68448","9","1","0","0","standalone"',
      '"Agricola","31260","7.5","0","1","0","standalone"',
      '"Azul","230802","0","1","0","0","standalone"',
    );
    expect(result).toEqual({
      ok: true,
      skipped: 0,
      rows: [
        { bggId: "68448", name: "7 Wonders", status: "owned", rating: 9 },
        {
          bggId: "31260",
          name: "Agricola",
          status: "previously_owned",
          rating: 8,
        },
        { bggId: "230802", name: "Azul", status: "owned", rating: null },
      ],
    });
  });

  it("skips wishlist-only rows and duplicates, and counts them", () => {
    const result = parse(
      '"A","1","0","1","0","0","standalone"',
      '"B","2","0","0","0","1","standalone"',
      '"A again","1","5","1","0","0","standalone"',
    );
    expect(result).toMatchObject({ ok: true, skipped: 2 });
    if (result.ok) expect(result.rows.map((r) => r.bggId)).toEqual(["1"]);
  });

  it("handles quoted names with commas and a BOM", () => {
    const result = parseBggCollectionCsv(
      `﻿${HEADER}\n"Dune, Imperium","316554","8","1","0","0","standalone"`,
    );
    expect(result).toMatchObject({
      ok: true,
      rows: [{ name: "Dune, Imperium", rating: 8 }],
    });
  });

  it("rejects a file that is not a BGG collection export", () => {
    expect(parseBggCollectionCsv("ID,Name,Year,Rank\n1,X,2000,1")).toEqual({
      ok: false,
      error: "not_bgg",
    });
  });

  it("reports empty files and files without importable rows", () => {
    expect(parseBggCollectionCsv("")).toEqual({ ok: false, error: "empty" });
    expect(parse('"B","2","0","0","0","1","standalone"')).toEqual({
      ok: false,
      error: "empty",
    });
  });

  it("ignores rows with a non-numeric id", () => {
    expect(parse('"X","abc","0","1","0","0","standalone"')).toEqual({
      ok: false,
      error: "empty",
    });
  });
});
