import { describe, expect, it } from "vitest";
import { serviceRoleKeySchema } from "./service-role-key";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl";

describe("serviceRoleKeySchema", () => {
  it("accepts a legacy service_role JWT", () => {
    expect(serviceRoleKeySchema.safeParse(jwt).success).toBe(true);
  });

  it("accepts a full new-style secret key", () => {
    expect(
      serviceRoleKeySchema.safeParse("sb_secret_" + "a".repeat(31)).success,
    ).toBe(true);
  });

  it.each([
    ["a masked key (asterisks)", "sb_secret_heqAF" + "*".repeat(26)],
    ["a masked key (bullets)", "sb_secret_heqAF" + "•".repeat(26)],
    ["a truncated secret key", "sb_secret_heqAF"],
    ["a publishable key", "sb_publishable_" + "a".repeat(30)],
    ["a random string", "not-a-key"],
    ["empty", ""],
    ["whitespace inside", "eyJhbGciOiJIUzI1NiJ9.eyJy b2xl.c2ln"],
  ])("rejects %s", (_label, key) => {
    expect(serviceRoleKeySchema.safeParse(key).success).toBe(false);
  });

  it("explains the likely cause for a masked key", () => {
    const result = serviceRoleKeySchema.safeParse(
      "sb_secret_heqAF" + "*".repeat(26),
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0].message).toMatch(/masked/i);
  });
});
