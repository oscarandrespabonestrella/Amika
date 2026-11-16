import { describe, expect, it } from "vitest";
import { pickDefaultSheet, type RankedSheet } from "./ranking";

const sheet = (id: string, extra: Partial<RankedSheet> = {}): RankedSheet => ({
  id,
  isMine: false,
  verified: false,
  score: 0,
  uses: 0,
  updatedAt: "2026-11-01T00:00:00Z",
  ...extra,
});

describe("pickDefaultSheet", () => {
  it("the last used sheet wins when it is still offered", () => {
    const sheets = [
      sheet("best", { verified: true, score: 0.9 }),
      sheet("mine", { isMine: true }),
      sheet("used"),
    ];
    expect(pickDefaultSheet(sheets, "used")).toBe("used");
  });

  it("a last used sheet that is not offered (disabled, unpublished) is ignored", () => {
    const sheets = [
      sheet("best", { verified: true }),
      sheet("mine", { isMine: true }),
    ];
    expect(pickDefaultSheet(sheets, "gone")).toBe("best");
  });

  it("a verified community sheet beats the user's own newer sheet when nothing was used before", () => {
    const sheets = [
      sheet("verified", { verified: true }),
      sheet("mine", { isMine: true, updatedAt: "2026-11-15T00:00:00Z" }),
    ];
    expect(pickDefaultSheet(sheets, null)).toBe("verified");
  });

  it("a community sheet with a positive score beats the user's own sheet", () => {
    const sheets = [
      sheet("good", { score: 0.4 }),
      sheet("mine", { isMine: true }),
    ];
    expect(pickDefaultSheet(sheets, null)).toBe("good");
  });

  it("a community sheet with score 0 and not verified loses to the user's own sheet", () => {
    const sheets = [sheet("unproven"), sheet("mine", { isMine: true })];
    expect(pickDefaultSheet(sheets, null)).toBe("mine");
  });

  it("among own sheets the most recently updated is chosen", () => {
    const sheets = [
      sheet("old", { isMine: true, updatedAt: "2026-11-01T00:00:00Z" }),
      sheet("new", { isMine: true, updatedAt: "2026-11-10T00:00:00Z" }),
    ];
    expect(pickDefaultSheet(sheets, null)).toBe("new");
  });

  it("with no own sheets, the first community sheet is chosen even with score 0", () => {
    expect(pickDefaultSheet([sheet("first"), sheet("second")], null)).toBe(
      "first",
    );
  });

  it("an empty list gives null", () => {
    expect(pickDefaultSheet([], null)).toBeNull();
    expect(pickDefaultSheet([], "anything")).toBeNull();
  });

  it("does not mutate its input", () => {
    const sheets = [
      sheet("a", { isMine: true, updatedAt: "2026-11-01T00:00:00Z" }),
      sheet("b", { isMine: true, updatedAt: "2026-11-10T00:00:00Z" }),
    ];
    const copy = JSON.stringify(sheets);
    pickDefaultSheet(sheets, null);
    expect(JSON.stringify(sheets)).toBe(copy);
  });
});
