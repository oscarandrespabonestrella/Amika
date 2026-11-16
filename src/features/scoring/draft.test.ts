import { describe, expect, it } from "vitest";
import { CATEGORY_TYPES, KEY_PATTERN } from "./engine/definition";
import { validateDefinition } from "./engine/validate";
import {
  canAddType,
  moveItem,
  newCategory,
  relabelCategory,
  slugifyKey,
  updateCounters,
} from "./draft";
import type { Category } from "./engine/definition";

describe("slugifyKey", () => {
  it('turns "Coins ÷ 3" into "coins_3"', () => {
    expect(slugifyKey("Coins ÷ 3", [])).toBe("coins_3");
  });

  it("strips accents and lowercases", () => {
    expect(slugifyKey("Épée Légère", [])).toBe("epee_legere");
  });

  it("suffixes duplicates (coins, coins_2, coins_3)", () => {
    expect(slugifyKey("Coins", ["coins"])).toBe("coins_2");
    expect(slugifyKey("Coins", ["coins", "coins_2"])).toBe("coins_3");
  });

  it('falls back to "category" for empty and non-latin or emoji-only labels', () => {
    expect(slugifyKey("", [])).toBe("category");
    expect(slugifyKey("   ", [])).toBe("category");
    expect(slugifyKey("🐦🥚", [])).toBe("category");
    expect(slugifyKey("鳥", ["category"])).toBe("category_2");
  });

  it("prefixes labels that start with a digit", () => {
    expect(slugifyKey("3 cards", [])).toMatch(KEY_PATTERN);
    expect(slugifyKey("3 cards", [])).toBe("c_3_cards");
  });

  it("truncates to 30 characters, suffixes included", () => {
    const long = "x".repeat(80);
    expect(slugifyKey(long, [])).toHaveLength(30);
    const second = slugifyKey(long, [slugifyKey(long, [])]);
    expect(second).toHaveLength(30);
    expect(second.endsWith("_2")).toBe(true);
  });

  it("always matches the key pattern, whatever the label", () => {
    for (const label of [
      "<img src=x onerror=alert(1)>",
      "a".repeat(10_000),
      "__a__",
      "Ünïcödé ✓",
      "1",
      "-",
      "\u0000‮",
    ])
      expect(slugifyKey(label, []), label).toMatch(KEY_PATTERN);
  });
});

describe("newCategory / canAddType", () => {
  const existing = ["first", "second"];

  it("returns a valid category for every type", () => {
    for (const type of CATEGORY_TYPES) {
      const category = newCategory(type, "Fresh", existing);
      const result = validateDefinition({
        schemaVersion: 1,
        categories: [
          { key: "first", label: "First", type: "number", scoring: true },
          { key: "second", label: "Second", type: "number", scoring: true },
          category,
        ],
      });
      expect(result.ok, type).toBe(true);
      expect(category.type).toBe(type);
      expect(category.key).toBe("fresh");
    }
  });

  it("derived needs two existing categories", () => {
    expect(canAddType("derived", ["only"])).toBe(false);
    expect(canAddType("derived", existing)).toBe(true);
    expect(canAddType("number", [])).toBe(true);
    expect(() => newCategory("derived", "D", ["only"])).toThrow();
  });

  it("uses a unique key when the label collides", () => {
    expect(newCategory("number", "First", existing).key).toBe("first_2");
  });
});

describe("moveItem", () => {
  it("moves an item and clamps at the ends without mutating", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(list, 2, 1)).toEqual(["a", "b", "c"]);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("validateDefinition shape issues", () => {
  it("carry the Zod message code and the path", () => {
    const result = validateDefinition({
      schemaVersion: 1,
      categories: [{ key: "a", label: "  ", type: "number" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues).toContainEqual({
        code: "shape",
        path: "categories.0.label",
        message: "required",
      });
  });
});

describe("relabelCategory", () => {
  const num = (key: string, label: string): Category => ({
    key,
    label,
    type: "number",
    scoring: true,
  });
  const calc = (refs: string[]): Category => ({
    key: "total",
    label: "Total",
    type: "derived",
    scoring: true,
    op: "sum",
    refs,
  });

  it("re-derives the key of an unsaved category and rewrites derived refs", () => {
    const list = [
      num("new_category", "New category"),
      num("b", "B"),
      calc(["new_category", "b"]),
    ];
    const next = relabelCategory(list, 0, "Coins", new Set(["b", "total"]));
    expect(next[0]).toMatchObject({ key: "coins", label: "Coins" });
    expect(next[2]).toMatchObject({ refs: ["coins", "b"] });
    expect(list[0].key).toBe("new_category"); // not mutated
  });

  it("keeps the key of a saved (frozen) category", () => {
    const list = [num("birds", "Birds")];
    const next = relabelCategory(
      list,
      0,
      "Feathered friends",
      new Set(["birds"]),
    );
    expect(next[0]).toMatchObject({ key: "birds", label: "Feathered friends" });
  });

  it("avoids collisions with the other keys", () => {
    const list = [num("fresh", "Fresh"), num("coins", "Coins")];
    expect(relabelCategory(list, 0, "Coins", new Set(["coins"]))[0].key).toBe(
      "coins_2",
    );
  });

  it("does not rename a category when the new label yields the same key", () => {
    const list = [num("coins", "Coins")];
    expect(relabelCategory(list, 0, "coins!", new Set())[0].key).toBe("coins");
  });
});

describe("updateCounters", () => {
  const inputs = ["tablets", "compass", "gears"];

  it("sets one counter and keeps the others", () => {
    expect(updateCounters(inputs, { tablets: 3 }, "compass", 2)).toEqual({
      tablets: 3,
      compass: 2,
    });
  });

  it("removes a counter when it is cleared, and returns undefined when none is left", () => {
    expect(
      updateCounters(inputs, { tablets: 3, compass: 2 }, "compass", undefined),
    ).toEqual({ tablets: 3 });
    expect(
      updateCounters(inputs, { tablets: 3 }, "tablets", undefined),
    ).toBeUndefined();
  });

  it("drops counters whose input no longer exists on the sheet", () => {
    expect(
      updateCounters(
        ["tablets", "compass"],
        { tablets: 3, gears: 1 },
        "compass",
        2,
      ),
    ).toEqual({ tablets: 3, compass: 2 });
  });
});
