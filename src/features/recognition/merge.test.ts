import { describe, expect, it } from "vitest";
import { mergeCandidates, type Signal } from "./merge";

const sig = (
  reason: Signal["reason"],
  strength: number,
  gameId: string | null,
  name = "Game",
  externalId: string | null = null,
): Signal => ({ reason, strength, gameId, externalId, name });

describe("mergeCandidates", () => {
  it("weights code above title above image", () => {
    const [code] = mergeCandidates([sig("code", 1, "a")]);
    const [title] = mergeCandidates([sig("title", 1, "a")]);
    const [image] = mergeCandidates([sig("image", 1, "a")]);
    expect(code.score).toBeCloseTo(0.95, 10);
    expect(title.score).toBeCloseTo(0.7, 10);
    expect(image.score).toBeCloseTo(0.35, 10);
  });

  it("scales by strength and caps the sum at 1", () => {
    const [half] = mergeCandidates([sig("title", 0.5, "a")]);
    expect(half.score).toBeCloseTo(0.35, 10);
    const [both] = mergeCandidates([sig("code", 1, "a"), sig("title", 1, "a")]);
    expect(both.score).toBe(1);
  });

  it("groups by game id, using the strongest signal of each reason", () => {
    const merged = mergeCandidates([
      sig("title", 0.4, "a", "Catan"),
      sig("title", 0.9, "a", "Catan"),
      sig("image", 0.5, "a", "Catan"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].reasons).toEqual(["title", "image"]);
    expect(merged[0].score).toBeCloseTo(0.7 * 0.9 + 0.35 * 0.5, 10);
  });

  it("merges a catalog hit and a BGG hit of the same game, and groups BGG-only hits by external id", () => {
    const merged = mergeCandidates([
      sig("title", 0.8, "a", "Catan"),
      sig("title", 0.8, null, "Azul", "ext-1"),
      sig("title", 0.6, null, "Azul", "ext-1"),
    ]);
    expect(merged.map((c) => c.name).sort()).toEqual(["Azul", "Catan"]);
    expect(merged.find((c) => c.name === "Azul")!.externalId).toBe("ext-1");
  });

  it("orders by score then name, deterministically, and respects the limit", () => {
    const signals = [
      sig("title", 0.5, "b", "Bravo"),
      sig("title", 0.5, "a", "Alpha"),
      sig("title", 0.9, "c", "Charlie"),
    ];
    expect(mergeCandidates(signals).map((c) => c.name)).toEqual([
      "Charlie",
      "Alpha",
      "Bravo",
    ]);
    expect(mergeCandidates(signals, 2)).toHaveLength(2);
  });

  it("returns nothing for no signals and ignores zero strength", () => {
    expect(mergeCandidates([])).toEqual([]);
    expect(mergeCandidates([sig("image", 0, "a")])).toEqual([]);
  });
});
