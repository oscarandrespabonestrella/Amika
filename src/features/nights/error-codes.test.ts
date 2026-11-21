import { describe, expect, it } from "vitest";
import { fromPgCode, toNightError } from "./error-codes";

describe("fromPgCode", () => {
  it("traduce los códigos de Postgres", () => {
    expect(fromPgCode("GN001")).toBe("not_friend");
    expect(fromPgCode("GN002")).toBe("closed");
    expect(fromPgCode("GN003")).toBe("already");
    expect(fromPgCode("GN004")).toBe("limit");
    expect(fromPgCode("GN005")).toBe("link_invalid");
    expect(fromPgCode("GN006")).toBe("not_owned");
    expect(fromPgCode("P0002")).toBe("not_found");
    expect(fromPgCode("42501")).toBe("not_found");
  });
  it("lo desconocido es failed", () => {
    expect(fromPgCode("XX999")).toBe("failed");
    expect(fromPgCode(undefined)).toBe("failed");
  });
});

describe("toNightError", () => {
  it("conserva los conocidos y el resto es failed", () => {
    expect(toNightError("rate_limited")).toBe("rate_limited");
    expect(toNightError("boom")).toBe("failed");
  });
});
