import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getBggApiToken, getSupabaseServiceRoleKey } from "./server";

afterEach(() => vi.unstubAllEnvs());

describe("getBggApiToken", () => {
  it("is undefined while the token is pending (unset or blank)", () => {
    vi.stubEnv("BGG_API_TOKEN", "");
    expect(getBggApiToken()).toBeUndefined();
    vi.unstubAllEnvs();
    expect(getBggApiToken()).toBeUndefined();
  });

  it("returns the token when configured", () => {
    vi.stubEnv("BGG_API_TOKEN", "abc123");
    expect(getBggApiToken()).toBe("abc123");
  });

  it("does not depend on the Supabase service key (a bad one must not break BGG checks)", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_heqAF" + "*".repeat(26));
    vi.stubEnv("BGG_API_TOKEN", "abc123");
    expect(() => getBggApiToken()).not.toThrow();
  });
});

describe("getSupabaseServiceRoleKey", () => {
  it("returns a valid key", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl";
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", jwt);
    expect(getSupabaseServiceRoleKey()).toBe(jwt);
  });

  it("fails loudly on a masked or missing key", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_heqAF" + "*".repeat(26));
    expect(() => getSupabaseServiceRoleKey()).toThrow(/masked/i);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => getSupabaseServiceRoleKey()).toThrow();
  });
});
