import { describe, expect, it } from "vitest";
import {
  identifyInputSchema,
  learnBarcodeSchema,
  savePhotoHashSchema,
} from "./schemas";

const GAME = "00000000-0000-4000-8000-0000000000a1";

describe("identifyInputSchema", () => {
  it("accepts any one signal, or all of them", () => {
    expect(
      identifyInputSchema.safeParse({ gtin: "9783161484100" }).success,
    ).toBe(true);
    expect(identifyInputSchema.safeParse({ lines: ["Wingspan"] }).success).toBe(
      true,
    );
    expect(
      identifyInputSchema.safeParse({ hash: "0123456789abcdef" }).success,
    ).toBe(true);
    const all = identifyInputSchema.parse({
      gtin: "9783161484100",
      lines: ["a b c", "d e f", "g h i"],
      hash: "0123456789abcdef",
    });
    expect(all.lines).toHaveLength(3);
  });

  it("defaults lines to an empty list", () => {
    expect(
      identifyInputSchema.parse({ hash: "0123456789abcdef" }).lines,
    ).toEqual([]);
  });

  it("refuses an empty request and a bag with nothing usable", () => {
    expect(identifyInputSchema.safeParse({}).success).toBe(false);
    expect(identifyInputSchema.safeParse({ lines: [] }).success).toBe(false);
  });

  it("refuses a 4th line, an empty or 81-character line", () => {
    expect(
      identifyInputSchema.safeParse({ lines: ["aaa", "bbb", "ccc", "ddd"] })
        .success,
    ).toBe(false);
    expect(identifyInputSchema.safeParse({ lines: [""] }).success).toBe(false);
    expect(
      identifyInputSchema.safeParse({ lines: ["x".repeat(81)] }).success,
    ).toBe(false);
    expect(
      identifyInputSchema.safeParse({ lines: ["x".repeat(80)] }).success,
    ).toBe(true);
  });

  it("refuses a malformed gtin or hash", () => {
    for (const gtin of ["123456789012", "97831614841ab", "97831614841000", ""])
      expect(identifyInputSchema.safeParse({ gtin }).success, gtin).toBe(false);
    for (const hash of [
      "0123456789ABCDEF",
      "0123",
      "0123456789abcdef0",
      "zzzzzzzzzzzzzzzz",
      "",
    ])
      expect(identifyInputSchema.safeParse({ hash }).success, hash).toBe(false);
  });

  it("is strict: no extra fields (nothing like image bytes can ride along)", () => {
    expect(
      identifyInputSchema.safeParse({
        hash: "0123456789abcdef",
        image: "data:image/png;base64,AAAA",
      }).success,
    ).toBe(false);
  });
});

describe("learnBarcodeSchema and savePhotoHashSchema", () => {
  it("validate their small payloads", () => {
    expect(
      learnBarcodeSchema.safeParse({ gtin: "9783161484100", gameId: GAME })
        .success,
    ).toBe(true);
    expect(
      learnBarcodeSchema.safeParse({ gtin: "9783161484100", gameId: "nope" })
        .success,
    ).toBe(false);
    expect(
      savePhotoHashSchema.safeParse({ gameId: GAME, hash: "0123456789abcdef" })
        .success,
    ).toBe(true);
    expect(
      savePhotoHashSchema.safeParse({ gameId: GAME, hash: "XYZ" }).success,
    ).toBe(false);
    expect(
      savePhotoHashSchema.safeParse({
        gameId: GAME,
        hash: "0123456789abcdef",
        extra: 1,
      }).success,
    ).toBe(false);
  });
});
