import { describe, expect, it } from "vitest";
import { displayNameSchema } from "./schemas";

describe("displayNameSchema", () => {
  it("trims and allows an empty name", () => {
    expect(
      displayNameSchema.parse({ displayName: "  Ada  " }).displayName,
    ).toBe("Ada");
    expect(displayNameSchema.parse({ displayName: "" }).displayName).toBe("");
  });

  it("accepts exactly 60 characters and rejects 61 with a stable code", () => {
    expect(
      displayNameSchema.safeParse({ displayName: "x".repeat(60) }).success,
    ).toBe(true);
    const result = displayNameSchema.safeParse({ displayName: "x".repeat(61) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("tooLong");
  });

  it("rejects non-string input", () => {
    expect(displayNameSchema.safeParse({ displayName: 5 }).success).toBe(false);
    expect(displayNameSchema.safeParse({}).success).toBe(false);
  });
});
