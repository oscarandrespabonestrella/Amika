import { describe, expect, it } from "vitest";
import { normalizePlayerName } from "./normalize";

describe("normalizePlayerName", () => {
  it('"Ana", "ana ", " ANA", "Aná" and "ana\\t" are the same player', () => {
    for (const variant of ["Ana", "ana ", " ANA", "Aná", "ana\t", "ÁNA"])
      expect(normalizePlayerName(variant), variant).toBe("ana");
  });

  it("collapses runs of whitespace and strips accents inside", () => {
    expect(normalizePlayerName("Ana  María")).toBe("ana maria");
    expect(normalizePlayerName("Ana\n\tMaría")).toBe("ana maria");
  });

  it("keeps emoji and non-latin letters", () => {
    expect(normalizePlayerName("🐦 Ana")).toBe("🐦 ana");
    expect(normalizePlayerName("鳥")).toBe("鳥");
  });

  it("empty and whitespace-only names normalize to the empty string", () => {
    expect(normalizePlayerName("")).toBe("");
    expect(normalizePlayerName("   \t ")).toBe("");
  });

  it("is idempotent", () => {
    for (const name of ["Ana  María", "ÁNA", "🐦  Zoë", ""]) {
      const once = normalizePlayerName(name);
      expect(normalizePlayerName(once)).toBe(once);
    }
  });

  it("different people stay different", () => {
    expect(normalizePlayerName("Ana")).not.toBe(normalizePlayerName("Anna"));
  });
});
