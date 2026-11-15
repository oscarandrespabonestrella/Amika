import { describe, expect, it } from "vitest";
import { formatMinutes, formatPlayers } from "./format";

const t = (key: string, v: Record<string, number>) =>
  `${key}:${Object.entries(v)
    .map(([k, n]) => `${k}=${n}`)
    .join(",")}`;

describe("formatPlayers", () => {
  it("returns null when nothing is known", () =>
    expect(formatPlayers(t, null, null)).toBeNull());
  it("uses the singular form when min equals max", () =>
    expect(formatPlayers(t, 2, 2)).toBe("players:count=2"));
  it("uses a range otherwise", () =>
    expect(formatPlayers(t, 2, 4)).toBe("playersRange:min=2,max=4"));
  it("falls back to the known bound", () => {
    expect(formatPlayers(t, 3, null)).toBe("players:count=3");
    expect(formatPlayers(t, null, 5)).toBe("players:count=5");
  });
});

describe("formatMinutes", () => {
  it("formats a single value and a range", () => {
    expect(formatMinutes(t, 30, 30)).toBe("minutes:count=30");
    expect(formatMinutes(t, 30, 90)).toBe("minutesRange:min=30,max=90");
    expect(formatMinutes(t, null, null)).toBeNull();
  });
});
