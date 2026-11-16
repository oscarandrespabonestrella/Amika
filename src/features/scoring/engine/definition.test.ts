import { describe, expect, it } from "vitest";
import { definitionSchema, SCORE_LIMITS } from "./definition";

const sheet = (categories: unknown[]) => ({ schemaVersion: 1, categories });
const number = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  label: key,
  type: "number",
  ...extra,
});
const parse = (value: unknown) => definitionSchema.safeParse(value);

describe("definitionSchema", () => {
  it("accepts a minimal valid sheet and defaults scoring to true", () => {
    const result = parse(sheet([number("birds")]));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.categories[0].scoring).toBe(true);
  });

  it("trims labels and rejects empty or 61-char labels", () => {
    const trimmed = parse(sheet([number("a", { label: "  Birds  " })]));
    expect(trimmed.success && trimmed.data.categories[0].label).toBe("Birds");
    expect(parse(sheet([number("a", { label: "   " })])).success).toBe(false);
    expect(parse(sheet([number("a", { label: "x".repeat(61) })])).success).toBe(
      false,
    );
    expect(parse(sheet([number("a", { label: "x".repeat(60) })])).success).toBe(
      true,
    );
  });

  it("rejects a hostile 10_000-char label", () => {
    expect(
      parse(sheet([number("a", { label: "<img onerror=x>".repeat(700) })]))
        .success,
    ).toBe(false);
  });

  it("rejects keys that do not match the key pattern", () => {
    for (const key of ["", "1abc", "Abc", "a-b", "a b", "x".repeat(31)])
      expect(parse(sheet([number(key)])).success, key).toBe(false);
  });

  it("rejects non-integer, NaN, infinite and out-of-range numbers", () => {
    for (const bad of [1.5, Number.NaN, Infinity, 1_000_001, -1_000_001, "7"])
      expect(
        parse(
          sheet([
            { key: "c", label: "c", type: "count_times", pointsEach: bad },
          ]),
        ).success,
        String(bad),
      ).toBe(false);
    expect(
      parse(
        sheet([
          { key: "c", label: "c", type: "count_times", pointsEach: 1_000_000 },
        ]),
      ).success,
    ).toBe(true);
  });

  it("rejects 41 categories and 51 table rows", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => number(`c${i}`));
    expect(parse(sheet(many(SCORE_LIMITS.maxCategories))).success).toBe(true);
    expect(parse(sheet(many(SCORE_LIMITS.maxCategories + 1))).success).toBe(
      false,
    );
    const table = (n: number) => ({
      key: "t",
      label: "t",
      type: "table",
      rows: Array.from({ length: n }, (_, i) => ({ value: i, points: i })),
    });
    expect(parse(sheet([table(50)])).success).toBe(true);
    expect(parse(sheet([table(51)])).success).toBe(false);
  });

  it("rejects an empty sheet", () => {
    expect(parse(sheet([])).success).toBe(false);
  });

  it("rejects unknown category types", () => {
    expect(parse(sheet([{ key: "a", label: "a", type: "eval" }])).success).toBe(
      false,
    );
  });

  it("rejects extra properties (strict) and a wrong schemaVersion", () => {
    expect(parse(sheet([number("a", { code: "1+1" })])).success).toBe(false);
    expect(parse({ schemaVersion: 2, categories: [number("a")] }).success).toBe(
      false,
    );
    expect(
      parse({ ...sheet([number("a")]), extra: true } as unknown).success,
    ).toBe(false);
  });

  it("requires exactly 2 refs for floor_div and 2..8 for the other derived ops", () => {
    const derived = (op: string, refs: string[]) => ({
      key: "d",
      label: "d",
      type: "derived",
      op,
      refs,
    });
    expect(parse(sheet([derived("floor_div", ["a", "b"])])).success).toBe(true);
    expect(parse(sheet([derived("floor_div", ["a", "b", "c"])])).success).toBe(
      false,
    );
    expect(parse(sheet([derived("sum", ["a"])])).success).toBe(false);
    expect(
      parse(
        sheet([
          derived(
            "min",
            Array.from({ length: 9 }, () => "a"),
          ),
        ]),
      ).success,
    ).toBe(false);
  });
});
