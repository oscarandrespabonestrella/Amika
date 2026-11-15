import { describe, expect, it } from "vitest";
import {
  bggQuerySchema,
  customGameSchema,
  externalIdSchema,
  parseSearchParams,
} from "./schemas";

describe("parseSearchParams", () => {
  it("reads valid values", () => {
    expect(
      parseSearchParams({
        q: " catan ",
        kind: "expansion",
        players: "4",
        time: "60",
      }),
    ).toEqual({
      q: "catan",
      kind: "expansion",
      players: 4,
      time: 60,
    });
  });

  it("drops invalid filters instead of failing", () => {
    expect(
      parseSearchParams({ q: "x", kind: "dlc", players: "0", time: "abc" }),
    ).toEqual({
      q: "x",
      kind: undefined,
      players: undefined,
      time: undefined,
    });
  });

  it("treats empty filters as absent (an empty number must not become 0)", () => {
    expect(parseSearchParams({ q: "", players: "", time: "" })).toEqual({
      q: "",
      kind: undefined,
      players: undefined,
      time: undefined,
    });
  });

  it("takes the first value of repeated params and ignores an overlong query", () => {
    expect(parseSearchParams({ q: ["a", "b"] }).q).toBe("a");
    expect(parseSearchParams({ q: "x".repeat(101) }).q).toBe("");
  });

  it("copes with missing params", () => {
    expect(parseSearchParams({})).toEqual({
      q: "",
      kind: undefined,
      players: undefined,
      time: undefined,
    });
  });
});

describe("external ids and BGG queries", () => {
  it.each(["13", "123456789"])("accepts id %s", (id) =>
    expect(externalIdSchema.safeParse(id).success).toBe(true),
  );
  it.each(["", "abc", "13&x=1", "-1", "1234567890", "../1"])(
    "rejects id %j",
    (id) => expect(externalIdSchema.safeParse(id).success).toBe(false),
  );

  it("requires 2-100 characters for a BGG search", () => {
    expect(bggQuerySchema.safeParse("a").success).toBe(false);
    expect(bggQuerySchema.safeParse("ab").success).toBe(true);
    expect(bggQuerySchema.safeParse("x".repeat(101)).success).toBe(false);
  });
});

const base = { name: "My Game", kind: "base" as const, locale: "en" as const };

describe("customGameSchema", () => {
  it("accepts a minimal game", () => {
    const parsed = customGameSchema.parse(base);
    expect(parsed).toMatchObject({ name: "My Game", kind: "base" });
    expect(parsed.minPlayers).toBeUndefined();
  });

  it("converts numeric strings and treats blanks as missing", () => {
    const parsed = customGameSchema.parse({
      ...base,
      yearPublished: "2020",
      minPlayers: "2",
      maxPlayers: "",
      minPlaytime: " 30 ",
      minAge: "0",
    });
    expect(parsed).toMatchObject({
      yearPublished: 2020,
      minPlayers: 2,
      minPlaytime: 30,
      minAge: 0,
    });
    expect(parsed.maxPlayers).toBeUndefined();
  });

  it("trims the name and reports stable error codes", () => {
    expect(customGameSchema.parse({ ...base, name: "  Spaced  " }).name).toBe(
      "Spaced",
    );

    const empty = customGameSchema.safeParse({ ...base, name: "   " });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(empty.error.issues[0].message).toBe("required");

    const long = customGameSchema.safeParse({ ...base, name: "x".repeat(201) });
    if (!long.success) expect(long.error.issues[0].message).toBe("tooLong");
  });

  it.each([
    ["yearPublished", "999"],
    ["yearPublished", "2101"],
    ["minPlayers", "0"],
    ["minPlayers", "100"],
    ["minPlayers", "2.5"],
    ["minPlayers", "abc"],
    ["minAge", "100"],
    ["minPlaytime", "-5"],
  ])("rejects %s = %s with code 'range'", (field, value) => {
    const result = customGameSchema.safeParse({ ...base, [field]: value });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain("range");
      expect(result.error.issues[0].path).toEqual([field]);
    }
  });

  it("rejects min greater than max for players and playtime", () => {
    const players = customGameSchema.safeParse({
      ...base,
      minPlayers: "5",
      maxPlayers: "2",
    });
    const time = customGameSchema.safeParse({
      ...base,
      minPlaytime: "90",
      maxPlaytime: "30",
    });
    expect(players.success || time.success).toBe(false);
    if (!players.success)
      expect(players.error.issues[0]).toMatchObject({
        path: ["maxPlayers"],
        message: "order",
      });
    if (!time.success)
      expect(time.error.issues[0]).toMatchObject({
        path: ["maxPlaytime"],
        message: "order",
      });
  });

  it("reports every problem at once (a bad field must not hide the min/max check)", () => {
    const result = customGameSchema.safeParse({
      ...base,
      yearPublished: "abc",
      minPlayers: "5",
      maxPlayers: "2",
      minPlaytime: "90",
      maxPlaytime: "30",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const found = result.error.issues
        .map((i) => `${String(i.path[0])}:${i.message}`)
        .sort();
      expect(found).toEqual([
        "maxPlayers:order",
        "maxPlaytime:order",
        "yearPublished:range",
      ]);
    }
  });

  it("rejects an unsupported locale and an unknown kind", () => {
    expect(customGameSchema.safeParse({ ...base, locale: "de" }).success).toBe(
      false,
    );
    expect(customGameSchema.safeParse({ ...base, kind: "dlc" }).success).toBe(
      false,
    );
  });

  it("limits the description length", () => {
    expect(
      customGameSchema.safeParse({ ...base, description: "x".repeat(5001) })
        .success,
    ).toBe(false);
  });
});
