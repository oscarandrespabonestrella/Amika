import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

import { displayNameFromClerk } from "./clerk-sync";

describe("displayNameFromClerk", () => {
  it("joins first and last name", () => {
    expect(
      displayNameFromClerk({
        id: "u",
        first_name: "Ada",
        last_name: "Lovelace",
      }),
    ).toBe("Ada Lovelace");
  });

  it("uses the first name alone when there is no last name", () => {
    expect(
      displayNameFromClerk({ id: "u", first_name: "Ada", last_name: null }),
    ).toBe("Ada");
  });

  it("falls back to the username, then to an empty string", () => {
    expect(displayNameFromClerk({ id: "u", username: "ada99" })).toBe("ada99");
    expect(displayNameFromClerk({ id: "u" })).toBe("");
  });

  it("never exceeds the 60 characters allowed by the database", () => {
    const long = "x".repeat(200);
    expect(displayNameFromClerk({ id: "u", first_name: long }).length).toBe(60);
  });
});
