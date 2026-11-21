import { describe, expect, it } from "vitest";
import { addNames } from "./names";

describe("addNames", () => {
  it("trims, drops blanks and duplicates (by roster identity)", () => {
    expect(addNames(["Ana"], [" ana ", "Luis", "  ", "Aná", "luis"])).toEqual([
      "Ana",
      "Luis",
    ]);
  });
  it("stops at the maximum", () => {
    expect(addNames(["a", "b"], ["c", "d", "e"], 3)).toEqual(["a", "b", "c"]);
  });
  it("does not mutate the current list", () => {
    const current = ["Ana"];
    addNames(current, ["Luis"]);
    expect(current).toEqual(["Ana"]);
  });
});
