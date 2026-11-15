import { describe, expect, it } from "vitest";
import { libraryInputSchema, parseLibraryFilters } from "./schemas";

const GAME = "00000000-0000-4000-8000-0000000000e1";

describe("libraryInputSchema", () => {
  it("accepts a status-only input and a full input", () => {
    expect(
      libraryInputSchema.safeParse({ gameId: GAME, status: "owned" }).success,
    ).toBe(true);
    expect(
      libraryInputSchema.safeParse({
        gameId: GAME,
        status: "previously_owned",
        isFavorite: true,
        rating: 10,
        notes: "  great  ",
      }).success,
    ).toBe(true);
  });

  it("trims notes and accepts null to clear rating and notes", () => {
    const parsed = libraryInputSchema.parse({
      gameId: GAME,
      notes: "  hi  ",
      rating: null,
    });
    expect(parsed.notes).toBe("hi");
    expect(parsed.rating).toBeNull();
    expect(
      libraryInputSchema.parse({ gameId: GAME, notes: null }).notes,
    ).toBeNull();
  });

  it.each([
    ["not a uuid", { gameId: "abc" }],
    ["wishlist status (not offered)", { gameId: GAME, status: "wishlist" }],
    ["rating 0", { gameId: GAME, rating: 0 }],
    ["rating 11", { gameId: GAME, rating: 11 }],
    ["fractional rating", { gameId: GAME, rating: 7.5 }],
    ["string rating", { gameId: GAME, rating: "7" }],
    ["notes over 2000", { gameId: GAME, notes: "x".repeat(2001) }],
    [
      "unknown key (no mass assignment)",
      { gameId: GAME, userId: "someone_else" },
    ],
    ["favorite as string", { gameId: GAME, isFavorite: "true" }],
    ["missing game", {}],
  ])("rejects %s", (_label, input) => {
    expect(libraryInputSchema.safeParse(input).success).toBe(false);
  });

  it("accepts exactly 2000 characters of notes", () => {
    expect(
      libraryInputSchema.safeParse({ gameId: GAME, notes: "x".repeat(2000) })
        .success,
    ).toBe(true);
  });
});

describe("parseLibraryFilters", () => {
  it("reads valid filters", () => {
    expect(
      parseLibraryFilters({ q: " catan ", status: "owned", favorites: "1" }),
    ).toEqual({
      q: "catan",
      status: "owned",
      favorites: true,
    });
  });

  it("drops invalid values instead of failing", () => {
    expect(
      parseLibraryFilters({
        q: "x".repeat(101),
        status: "wishlist",
        favorites: "yes",
      }),
    ).toEqual({
      q: "",
      status: undefined,
      favorites: false,
    });
  });

  it("defaults to no filters", () => {
    expect(parseLibraryFilters({})).toEqual({
      q: "",
      status: undefined,
      favorites: false,
    });
  });

  it("takes the first value of repeated params", () => {
    expect(
      parseLibraryFilters({ status: ["previously_owned", "owned"] }).status,
    ).toBe("previously_owned");
  });
});
