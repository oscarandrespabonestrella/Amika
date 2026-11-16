import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate";
import { SEVEN_WONDERS, WINGSPAN } from "./fixtures";
import { validateDefinition } from "./validate";

const sheet = (categories: unknown[]) => ({ schemaVersion: 1, categories });
const num = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  label: key,
  type: "number",
  ...extra,
});
const derived = (key: string, refs: string[], op = "sum", scoring = true) => ({
  key,
  label: key,
  type: "derived",
  op,
  refs,
  scoring,
});
const pointsOf = (e: ReturnType<typeof evaluate>, key: string) =>
  e.categories.find((c) => c.key === key);

describe("fixtures are valid sheets", () => {
  it("SEVEN_WONDERS and WINGSPAN pass validateDefinition", () => {
    expect(validateDefinition(SEVEN_WONDERS).ok).toBe(true);
    expect(validateDefinition(WINGSPAN).ok).toBe(true);
  });
});

describe("7 Wonders", () => {
  const values = {
    military: 6,
    coins: 10,
    wonders: 10,
    civilian: 12,
    commerce: 4,
    guilds: 6,
    science: { tablets: 3, compass: 2, gears: 1 },
  };

  it("totals 62 (coins 10 → 3 pts, science 3/2/1 → 21 pts)", () => {
    const result = evaluate(SEVEN_WONDERS, values);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(62);
    expect(pointsOf(result, "coins")?.points).toBe(3);
    expect(pointsOf(result, "science")?.points).toBe(21);
  });

  it("negative military points lower the total", () => {
    expect(evaluate(SEVEN_WONDERS, { ...values, military: -3 }).total).toBe(53);
  });

  it("coins: 2 → 0, 3 → 1, 11 → 3", () => {
    const coins = (n: number) =>
      pointsOf(evaluate(SEVEN_WONDERS, { coins: n }), "coins")?.points;
    expect([coins(2), coins(3), coins(11)]).toEqual([0, 1, 3]);
  });

  it("an empty entry scores 0 without errors", () => {
    const result = evaluate(SEVEN_WONDERS, {});
    expect(result).toMatchObject({ ok: true, total: 0 });
  });

  it("returns categories in definition order", () => {
    expect(
      evaluate(SEVEN_WONDERS, values).categories.map((c) => c.key),
    ).toEqual(SEVEN_WONDERS.categories.map((c) => c.key));
  });
});

describe("Wingspan", () => {
  it("birds 31, bonus 8, goals 12, eggs 14, food 5, tucked 7 totals 77", () => {
    const result = evaluate(WINGSPAN, {
      birds: 31,
      bonus_cards: 8,
      round_goals: 12,
      eggs: 14,
      food_on_cards: 5,
      tucked_cards: 7,
    });
    expect(result).toMatchObject({ ok: true, total: 77 });
  });
});

describe("category types", () => {
  it("count_times multiplies; per_n divides; boolean and choice and table map to points", () => {
    const definition = sheet([
      { key: "ct", label: "ct", type: "count_times", pointsEach: 3 },
      { key: "pn", label: "pn", type: "per_n", n: 5, pointsPer: 2 },
      { key: "bo", label: "bo", type: "boolean", points: 4 },
      {
        key: "ch",
        label: "ch",
        type: "choice",
        options: [
          { key: "low", label: "low", points: 1 },
          { key: "high", label: "high", points: 9 },
        ],
      },
      {
        key: "ta",
        label: "ta",
        type: "table",
        rows: [
          { value: 0, points: 0 },
          { value: 1, points: 5 },
          { value: 2, points: 12 },
        ],
      },
    ]);
    const result = evaluate(definition, {
      ct: 4,
      pn: 13,
      bo: true,
      ch: "high",
      ta: 2,
    });
    expect(result.categories.map((c) => c.points)).toEqual([12, 4, 4, 9, 12]);
    expect(result.total).toBe(41);
    expect(evaluate(definition, { bo: false }).total).toBe(0);
  });

  it("choice: unknown option → unknownOption; no selection → 0", () => {
    const definition = sheet([
      {
        key: "ch",
        label: "ch",
        type: "choice",
        options: [{ key: "a", label: "a", points: 5 }],
      },
    ]);
    expect(pointsOf(evaluate(definition, { ch: "zzz" }), "ch")).toEqual({
      key: "ch",
      points: 0,
      error: "unknownOption",
    });
    expect(evaluate(definition, {})).toMatchObject({ ok: true, total: 0 });
  });

  it("table: a value that is not listed → notInTable", () => {
    const definition = sheet([
      {
        key: "ta",
        label: "ta",
        type: "table",
        rows: [{ value: 1, points: 5 }],
      },
    ]);
    expect(pointsOf(evaluate(definition, { ta: 7 }), "ta")?.error).toBe(
      "notInTable",
    );
  });

  it("respects min and max of a number category", () => {
    const definition = sheet([num("a", { min: 0, max: 10 })]);
    expect(evaluate(definition, { a: 10 }).ok).toBe(true);
    expect(pointsOf(evaluate(definition, { a: 11 }), "a")?.error).toBe(
      "outOfRange",
    );
    expect(pointsOf(evaluate(definition, { a: -1 }), "a")?.error).toBe(
      "outOfRange",
    );
  });

  it("set_bonus: counters must be non-negative integers and known", () => {
    const set = SEVEN_WONDERS.categories.find((c) => c.key === "science");
    expect(set).toBeDefined();
    const bad = (value: unknown) =>
      pointsOf(evaluate(SEVEN_WONDERS, { science: value as never }), "science")
        ?.error;
    expect(bad({ tablets: -1 })).toBe("outOfRange");
    expect(bad({ tablets: 1.5 })).toBe("invalid");
    expect(bad({ nope: 1 })).toBe("invalid");
    expect(bad([1, 2, 3])).toBe("invalid");
    expect(bad(5)).toBe("invalid");
  });
});

describe("derived categories", () => {
  it("min/product/sum/max over support categories count only the derived result", () => {
    const base = [
      num("a", { scoring: false }),
      num("b", { scoring: false }),
      num("c", { scoring: false }),
    ];
    const values = { a: 3, b: 4, c: 5 };
    const total = (op: string, refs = ["a", "b", "c"]) =>
      evaluate(sheet([...base, derived("d", refs, op)]), values).total;
    expect(total("min")).toBe(3);
    expect(total("max")).toBe(5);
    expect(total("sum")).toBe(12);
    expect(total("product")).toBe(60);
    expect(total("floor_div", ["c", "a"])).toBe(1);
  });

  it("evaluates chains regardless of declaration order", () => {
    const definition = sheet([
      derived("y", ["x", "a"], "sum"),
      derived("x", ["a", "b"], "product", false),
      num("a"),
      num("b"),
    ]);
    // a=2,b=3 → x=6 (support) → y=6+2=8; a and b also score: 2+3
    expect(evaluate(definition, { a: 2, b: 3 }).total).toBe(8 + 2 + 3);
  });

  it("floor_div by zero → divisionByZero, 0 points, other categories unaffected", () => {
    const definition = sheet([
      num("a"),
      num("b"),
      num("other"),
      derived("d", ["a", "b"], "floor_div"),
    ]);
    const result = evaluate(definition, { a: 7, b: 0, other: 5 });
    expect(pointsOf(result, "d")).toEqual({
      key: "d",
      points: 0,
      error: "divisionByZero",
    });
    expect(result.ok).toBe(false);
    expect(result.total).toBe(7 + 0 + 5);
  });

  it("a dependency on an errored category → dependency error on the derived one", () => {
    const definition = sheet([
      num("a", { min: 0 }),
      num("b"),
      derived("d", ["a", "b"]),
    ]);
    const result = evaluate(definition, { a: -5, b: 2 });
    expect(pointsOf(result, "a")?.error).toBe("outOfRange");
    expect(pointsOf(result, "d")).toEqual({
      key: "d",
      points: 0,
      error: "dependency",
    });
  });

  it("a product that would overflow is an error, not a huge number", () => {
    const refs = ["a", "b", "c", "d"];
    const definition = sheet([
      ...refs.map((k) => num(k, { scoring: false })),
      derived("p", refs, "product"),
    ]);
    const result = evaluate(definition, { a: 1e6, b: 1e6, c: 1e6, d: 1e6 });
    expect(pointsOf(result, "p")?.error).toBe("outOfRange");
    expect(Number.isSafeInteger(result.total)).toBe(true);
  });
});

describe("untrusted values", () => {
  it.each([
    1.5,
    Number.NaN,
    Infinity,
    -Infinity,
    1e21,
    "7",
    {},
    [],
    null,
    true,
  ])(
    "%s where a number is expected → a field error and a finite integer total",
    (bad) => {
      const result = evaluate(sheet([num("a"), num("b")]), {
        a: bad as never,
        b: 4,
      });
      if (bad === null) {
        expect(result).toMatchObject({ ok: true, total: 4 });
        return;
      }
      expect(pointsOf(result, "a")?.error).toMatch(/invalid|outOfRange/);
      expect(result.ok).toBe(false);
      expect(Number.isSafeInteger(result.total)).toBe(true);
      expect(result.total).toBe(4);
    },
  );

  it("ignores values for keys that are not in the sheet", () => {
    expect(evaluate(sheet([num("a")]), { a: 1, ghost: 99 }).total).toBe(1);
  });
});

describe("untrusted definitions", () => {
  const bad: [string, unknown][] = [
    [
      "a cycle",
      sheet([num("a"), derived("x", ["a", "y"]), derived("y", ["x", "a"])]),
    ],
    ["an unknown ref", sheet([num("a"), derived("x", ["a", "zzz"])])],
    [
      "an oversized definition",
      sheet(Array.from({ length: 1000 }, (_, i) => num(`k${i}`))),
    ],
    ["a wrong shape", { schemaVersion: 1, categories: "nope" }],
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
    ["a string", "1+1"],
  ];
  it.each(bad)(
    "%s → invalidDefinition, without throwing",
    (_name, definition) => {
      expect(evaluate(definition, { a: 1 })).toEqual({
        ok: false,
        total: 0,
        categories: [],
        invalidDefinition: true,
      });
    },
  );

  it("does not throw when the values object is null or an array", () => {
    expect(() => evaluate(sheet([num("a")]), null as never)).not.toThrow();
    expect(() => evaluate(sheet([num("a")]), [] as never)).not.toThrow();
  });
});
