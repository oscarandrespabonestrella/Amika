import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { assertLocale } from "./locale";

describe("assertLocale", () => {
  it.each(["en", "es", "fr", "pt"])("accepts %s", (locale) => {
    expect(assertLocale(locale)).toBe(locale);
  });

  it.each(["de", "EN", "", "en-US", "../etc"])("rejects %j", (value) => {
    expect(() => assertLocale(value)).toThrow("NEXT_NOT_FOUND");
  });
});
