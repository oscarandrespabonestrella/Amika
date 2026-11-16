import { describe, expect, it } from "vitest";
import {
  sheetCreateSchema,
  sheetIdSchema,
  sheetRenameSchema,
  sheetVersionSchema,
} from "./schemas";

const ID = "00000000-0000-4000-8000-000000000001";
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
