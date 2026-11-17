import { describe, expect, it } from "vitest";
import { friendCodeSchema, userIdSchema } from "./schemas";

describe("friend schemas", () => {
  it("el código de amigo rechaza formatos inválidos", () => {
    expect(friendCodeSchema.safeParse("a".repeat(64)).success).toBe(true);
    for (const bad of [
      "",
      "abc",
      "A".repeat(64),
      "g".repeat(64),
      "a".repeat(63),
    ])
      expect(friendCodeSchema.safeParse(bad).success).toBe(false);
  });

  it("el id de usuario no puede estar vacío ni ser enorme", () => {
    expect(userIdSchema.safeParse("user_123").success).toBe(true);
    expect(userIdSchema.safeParse("").success).toBe(false);
    expect(userIdSchema.safeParse("x".repeat(201)).success).toBe(false);
  });
});
