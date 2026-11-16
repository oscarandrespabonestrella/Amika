import { describe, expect, it } from "vitest";
import { cleanOcrLines, normalizeTitle, textSimilarity } from "./text";

describe("normalizeTitle", () => {
  it("strips accents, punctuation and case", () => {
    expect(normalizeTitle("Catán: 5ª Ed.!")).toBe("catan 5a ed");
  });
  it("collapses whitespace and handles empty", () => {
    expect(normalizeTitle("  Seven   Wonders ")).toBe("seven wonders");
    expect(normalizeTitle("")).toBe("");
  });
});

describe("textSimilarity", () => {
  it("ignores accents and case", () => {
    expect(textSimilarity("Catan", "catán")).toBe(1);
  });
  it("is low for unrelated titles", () => {
    expect(textSimilarity("Catan", "Azul")).toBeLessThan(0.2);
  });
  it("is 0 for empty input", () => {
    expect(textSimilarity("", "Azul")).toBe(0);
    expect(textSimilarity("", "")).toBe(0);
  });
  it("tolerates a typo", () => {
    expect(textSimilarity("Wingspan", "Wingspn")).toBeGreaterThan(0.5);
  });
});

const line = (text: string, confidence = 90, height = 20) => ({
  text,
  confidence,
  height,
});

describe("cleanOcrLines", () => {
  it("drops low-confidence and too-short lines", () => {
    expect(
      cleanOcrLines([line("Wingspan"), line("xx"), line("Blurry", 20)]),
    ).toEqual(["Wingspan"]);
  });

  it("orders by size then confidence, dedupes by normalized text, caps at max", () => {
    const result = cleanOcrLines([
      line("Small text", 95, 10),
      line("WINGSPAN", 80, 40),
      line("wingspan", 99, 30),
      line("Birds game", 90, 25),
      line("Another line", 90, 12),
    ]);
    expect(result).toEqual(["WINGSPAN", "Birds game", "Another line"]);
  });

  it("truncates an overlong line to 80 characters", () => {
    const [only] = cleanOcrLines([line("a".repeat(500))]);
    expect(only).toHaveLength(80);
  });

  it("ignores lines with no letters or digits (emoji, symbols)", () => {
    expect(cleanOcrLines([line("💥💥💥"), line("!!!---")])).toEqual([]);
  });

  it("keeps markup as plain text (it is only ever displayed as text)", () => {
    expect(cleanOcrLines([line("<img src=x>")])).toEqual(["<img src=x>"]);
  });
});
