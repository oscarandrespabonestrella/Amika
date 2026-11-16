import { describe, expect, it } from "vitest";
import { validateDefinition } from "./validate";

const num = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  label: key,
  type: "number",
  ...extra,
});
const derived = (key: string, refs: string[], op = "sum") => ({
  key,
  label: key,
  type: "derived",
  op,
  refs,
});
const sheet = (categories: unknown[]) => ({ schemaVersion: 1, categories });
const codes = (input: unknown) => {
  const result = validateDefinition(input);
  return result.ok ? [] : result.issues.map((i) => i.code);
};

describe("validateDefinition", () => {
  it("returns the parsed definition when valid", () => {
    const result = validateDefinition(sheet([num("a"), num("b")]));
    expect(result.ok).toBe(true);
  });

  it("flags duplicate category keys", () => {
    expect(codes(sheet([num("a"), num("a")]))).toContain("duplicateKey");
  });

  it("flags derived refs to unknown keys", () => {
    expect(codes(sheet([num("a"), derived("d", ["a", "zzz"])]))).toContain(
      "unknownRef",
    );
  });

  it("flags cycles, including a self reference", () => {
    expect(
      codes(
        sheet([num("a"), derived("x", ["a", "y"]), derived("y", ["x", "a"])]),
      ),
    ).toContain("cycle");
    expect(codes(sheet([num("a"), derived("x", ["x", "a"])]))).toContain(
      "cycle",
    );
  });

  it("accepts derived chains without cycles", () => {
    expect(
      validateDefinition(
        sheet([
          num("a"),
          num("b"),
          derived("x", ["a", "b"]),
          derived("y", ["x", "a"], "max"),
        ]),
      ).ok,
    ).toBe(true);
  });

  it("reports floor_div with 3 refs as a shape issue", () => {
    expect(
      codes(
        sheet([
          num("a"),
          num("b"),
          num("c"),
          derived("d", ["a", "b", "c"], "floor_div"),
        ]),
      ),
    ).toContain("shape");
  });

  it("flags duplicate choice options, table values and set inputs", () => {
    expect(
      codes(
        sheet([
          {
            key: "c",
            label: "c",
            type: "choice",
            options: [
              { key: "x", label: "x", points: 1 },
              { key: "x", label: "y", points: 2 },
            ],
          },
        ]),
      ),
    ).toContain("duplicateOption");
    expect(
      codes(
        sheet([
          {
            key: "t",
            label: "t",
            type: "table",
            rows: [
              { value: 1, points: 1 },
              { value: 1, points: 2 },
            ],
          },
        ]),
      ),
    ).toContain("duplicateTableValue");
    expect(
      codes(
        sheet([
          {
            key: "s",
            label: "s",
            type: "set_bonus",
            perSet: 7,
            inputs: [
              { key: "a", label: "a" },
              { key: "a", label: "b" },
            ],
          },
        ]),
      ),
    ).toContain("duplicateInput");
  });

  it("flags a sheet where nothing counts toward the total", () => {
    expect(codes(sheet([num("a", { scoring: false })]))).toContain(
      "noScoringCategory",
    );
  });

  it("flags a definition larger than 50_000 bytes", () => {
    const big = sheet(
      Array.from({ length: 40 }, (_, i) => ({
        key: `t${i}`,
        label: "t",
        type: "table",
        rows: Array.from({ length: 50 }, (_, v) => ({
          value: v,
          points: 1_000_000,
        })),
      })),
    );
    expect(codes(big)).toContain("tooLarge");
  });

  it("never throws, whatever it is given", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const input of [null, undefined, [], "x", 42, {}, circular]) {
      const result = validateDefinition(input);
      expect(result.ok).toBe(false);
    }
  });
});
