import { describe, expect, it } from "vitest";
import { mapSavePlayError } from "./save-errors";

describe("mapSavePlayError", () => {
  it("a player twice in a match (unique violation, even when the names looked different)", () => {
    expect(mapSavePlayError("23505", "duplicate key value")).toBe(
      "duplicate_player",
    );
  });

  it("the roster cap and the match cap are different limits", () => {
    expect(mapSavePlayError("P0001", "too many players")).toBe("players_limit");
    expect(mapSavePlayError("P0001", "too many matches")).toBe("limit");
    expect(mapSavePlayError("P0001", "too many players in this match")).toBe(
      "limit",
    );
    expect(mapSavePlayError("P0001", "too many expansions in this match")).toBe(
      "limit",
    );
  });

  it("not visible / not yours maps to not_found", () => {
    for (const code of ["42501", "23503", "P0002"])
      expect(mapSavePlayError(code, ""), code).toBe("not_found");
  });

  it("anything else is unexpected (null: the caller rethrows)", () => {
    expect(mapSavePlayError("XX000", "boom")).toBeNull();
    expect(mapSavePlayError(undefined, undefined)).toBeNull();
  });
});
