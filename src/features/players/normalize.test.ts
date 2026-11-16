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

describe("normalizePlayerName: only Latin accents are stripped (never wider than the database)", () => {
  it("keeps vowel signs of other scripts, so different names stay different", () => {
    // Devanagari: "कमल" and "कमला" differ by a vowel sign (a combining mark).
    expect(normalizePlayerName("कमल")).not.toBe(normalizePlayerName("कमला"));
    // Thai tone/vowel marks and Hebrew points are combining marks too.
    expect(normalizePlayerName("ก่า")).not.toBe(normalizePlayerName("กา"));
  });

  it("still strips the combining diacritics that unaccent removes", () => {
    for (const variant of ["José", "José", "JOSÉ", "jóse"])
      expect(normalizePlayerName(variant), variant).toBe("jose");
  });
});
