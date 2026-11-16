import { describe, expect, it } from "vitest";
import {
  composeCopyTitle,
  SHEET_TITLE_MAX,
  sheetCreateSchema,
  sheetIdSchema,
  sheetRenameSchema,
  sheetVersionSchema,
  voteSchema,
} from "./schemas";

const ID = "00000000-0000-4000-8000-000000000001";
const PLAY_ID = "00000000-0000-4000-8000-000000000002";
const definition = { schemaVersion: 1, categories: [] }; // validated separately

describe("sheetCreateSchema", () => {
  const valid = { gameId: ID, title: "7 Wonders", locale: "en", definition };

  it("accepts a valid create payload", () => {
    expect(sheetCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("trims the title", () => {
    const parsed = sheetCreateSchema.safeParse({ ...valid, title: "  Hi  " });
    expect(parsed.success && parsed.data.title).toBe("Hi");
  });

  it("rejects an empty or 81-char title, a bad locale and extra keys", () => {
    expect(sheetCreateSchema.safeParse({ ...valid, title: " " }).success).toBe(
      false,
    );
    expect(
      sheetCreateSchema.safeParse({ ...valid, title: "x".repeat(81) }).success,
    ).toBe(false);
    expect(
      sheetCreateSchema.safeParse({ ...valid, locale: "xx" }).success,
    ).toBe(false);
    expect(
      sheetCreateSchema.safeParse({ ...valid, visibility: "public" }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid game id", () => {
    expect(sheetCreateSchema.safeParse({ ...valid, gameId: "1" }).success).toBe(
      false,
    );
  });
});

describe("sheetVersionSchema baseVersion", () => {
  it("is required and must be a positive integer", () => {
    const base = { sheetId: ID, definition };
    expect(sheetVersionSchema.safeParse(base).success).toBe(false);
    for (const bad of [0, -1, 1.5, "2", null])
      expect(
        sheetVersionSchema.safeParse({ ...base, baseVersion: bad }).success,
        String(bad),
      ).toBe(false);
    expect(
      sheetVersionSchema.safeParse({ ...base, baseVersion: 3 }).success,
    ).toBe(true);
  });
});

describe("sheetVersionSchema / sheetRenameSchema / sheetIdSchema", () => {
  it("accept valid payloads and reject extra keys and non-uuids", () => {
    expect(
      sheetVersionSchema.safeParse({ sheetId: ID, definition, baseVersion: 1 })
        .success,
    ).toBe(true);
    expect(
      sheetVersionSchema.safeParse({
        sheetId: ID,
        definition,
        baseVersion: 1,
        v: 1,
      }).success,
    ).toBe(false);
    expect(
      sheetRenameSchema.safeParse({ sheetId: ID, title: "New", locale: "fr" })
        .success,
    ).toBe(true);
    expect(
      sheetRenameSchema.safeParse({ sheetId: "x", title: "New", locale: "fr" })
        .success,
    ).toBe(false);
    expect(sheetIdSchema.safeParse(ID).success).toBe(true);
    expect(sheetIdSchema.safeParse("nope").success).toBe(false);
  });
});

describe("composeCopyTitle", () => {
  it("appends the suffix", () => {
    expect(composeCopyTitle("7 Wonders", "(copy)")).toBe("7 Wonders (copy)");
  });

  it("never exceeds the title limit, suffix included", () => {
    const result = composeCopyTitle("x".repeat(200), "(copy)");
    expect(Array.from(result)).toHaveLength(SHEET_TITLE_MAX);
    expect(result.endsWith(" (copy)")).toBe(true);
  });

  it("does not split an emoji at the cut", () => {
    const result = composeCopyTitle("🐦".repeat(100), "(copy)");
    expect(Array.from(result).length).toBeLessThanOrEqual(SHEET_TITLE_MAX);
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // no lone surrogate
    expect(result.endsWith(" (copy)")).toBe(true);
  });

  it("an empty title yields just the suffix, still a valid title", () => {
    expect(composeCopyTitle("   ", "(copy)")).toBe("(copy)");
  });
});

describe("voteSchema", () => {
  const base = { versionId: ID, playId: PLAY_ID };
  const parse = (value: unknown) =>
    voteSchema.safeParse({ ...base, ...(value as object) });

  it("an up vote has no reason", () => {
    expect(parse({ kind: "up", reason: null }).success).toBe(true);
    expect(parse({ kind: "up", reason: "nice" }).success).toBe(false);
  });

  it("a flag needs a reason of 1 to 300 characters, trimmed", () => {
    expect(parse({ kind: "flag", reason: null }).success).toBe(false);
    expect(parse({ kind: "flag", reason: "   " }).success).toBe(false);
    expect(parse({ kind: "flag", reason: "x".repeat(300) }).success).toBe(true);
    expect(parse({ kind: "flag", reason: "x".repeat(301) }).success).toBe(
      false,
    );
    const trimmed = parse({ kind: "flag", reason: "  Coins are wrong  " });
    expect(trimmed.success && trimmed.data.reason).toBe("Coins are wrong");
  });

  it("rejects unknown kinds, non-uuid ids and extra keys", () => {
    expect(parse({ kind: "meh", reason: null }).success).toBe(false);
    expect(
      voteSchema.safeParse({
        versionId: "x",
        playId: PLAY_ID,
        kind: "up",
        reason: null,
      }).success,
    ).toBe(false);
    expect(parse({ kind: "up", reason: null, userId: "someone" }).success).toBe(
      false,
    );
  });
});
