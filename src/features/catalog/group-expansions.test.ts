import { describe, expect, it } from "vitest";
import { groupExpansions } from "./group-expansions";

const game = (id: string, kind: "base" | "expansion") => ({ id, kind });

describe("groupExpansions", () => {
  it("hangs an expansion from its base game when both are in the list", () => {
    const items = [
      game("catan", "base"),
      game("seafarers", "expansion"),
      game("azul", "base"),
      game("cities", "expansion"),
    ];
    const parents = new Map([
      ["seafarers", "catan"],
      ["cities", "catan"],
    ]);
    const groups = groupExpansions(items, parents);
    expect(groups.map((g) => g.item.id)).toEqual(["catan", "azul"]);
    expect(groups[0].expansions.map((e) => e.id)).toEqual([
      "seafarers",
      "cities",
    ]);
    expect(groups[1].expansions).toEqual([]);
  });

  it("keeps an expansion on its own when its base game is not in the list", () => {
    const items = [game("seafarers", "expansion"), game("azul", "base")];
    const groups = groupExpansions(items, new Map([["seafarers", "catan"]]));
    expect(groups.map((g) => g.item.id)).toEqual(["seafarers", "azul"]);
  });

  it("keeps an expansion on its own when nothing says what it expands", () => {
    const groups = groupExpansions([game("x", "expansion")], new Map());
    expect(groups.map((g) => g.item.id)).toEqual(["x"]);
  });

  it("never nests a base game, nor an expansion under itself", () => {
    const items = [game("a", "base"), game("b", "expansion")];
    const groups = groupExpansions(
      items,
      new Map([
        ["a", "b"],
        ["b", "b"],
      ]),
    );
    expect(groups.map((g) => g.item.id)).toEqual(["a", "b"]);
  });

  it("does not drop an expansion of an expansion (the parent is itself nested)", () => {
    const items = [
      game("base", "base"),
      game("exp1", "expansion"),
      game("exp2", "expansion"),
    ];
    const groups = groupExpansions(
      items,
      new Map([
        ["exp1", "base"],
        ["exp2", "exp1"],
      ]),
    );
    // exp2's parent is itself nested, so it stays reachable at the top level.
    expect(groups.map((g) => g.item.id)).toEqual(["base", "exp2"]);
    expect(groups[0].expansions.map((e) => e.id)).toEqual(["exp1"]);
  });
});
