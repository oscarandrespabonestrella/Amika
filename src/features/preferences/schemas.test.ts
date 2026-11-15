import { describe, expect, it } from "vitest";
import { preferencesSchema } from "./schemas";

describe("preferencesSchema", () => {
  it.each([
    [{ theme: "dark" }],
    [{ theme: "light" }],
    [{ theme: "system" }],
    [{ locale: "es" }],
    [{ theme: "dark", locale: "fr" }],
  ])("accepts %j", (input) => {
    expect(preferencesSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    [{}],
    [{ theme: "neon" }],
    [{ locale: "de" }],
    [{ locale: "en-US" }],
    [{ theme: "dark", id: "someone_else" }], // unknown keys are rejected (no mass assignment)
    [null],
    ["dark"],
  ])("rejects %j", (input) => {
    expect(preferencesSchema.safeParse(input).success).toBe(false);
  });
});
