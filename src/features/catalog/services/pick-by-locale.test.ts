import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { pickByLocale } from "./game-service";

const rows = (...locales: string[]) =>
  locales.map((locale) => ({ locale, name: `n-${locale}` }));

describe("pickByLocale", () => {
  it("prefers the requested language", () => {
    expect(pickByLocale(rows("en", "es", "fr"), "es", "en")?.locale).toBe("es");
  });
  it("falls back to the game's original language, then English", () => {
    expect(pickByLocale(rows("en", "fr"), "es", "fr")?.locale).toBe("fr");
    expect(pickByLocale(rows("en", "fr"), "es", "de")?.locale).toBe("en");
  });
  it("falls back to any translation, and to null when there are none", () => {
    expect(pickByLocale(rows("fr"), "es", "de")?.locale).toBe("fr");
    expect(pickByLocale([], "es", "en")).toBeNull();
  });
});
