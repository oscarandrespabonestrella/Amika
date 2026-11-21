import { describe, expect, it } from "vitest";
import {
  GUEST_LIMITS,
  hashSecret,
  isGuestOverLimit,
  isTokenShape,
  newGuestKey,
} from "./token";

describe("guest token helpers", () => {
  it("hashes with sha256 hex", () => {
    expect(hashSecret("a")).toBe(
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    );
  });

  it("accepts 43 base64url characters only", () => {
    expect(isTokenShape("A".repeat(43))).toBe(true);
    expect(isTokenShape(newGuestKey())).toBe(true);
    expect(isTokenShape("A".repeat(42))).toBe(false);
    expect(isTokenShape("A".repeat(44))).toBe(false);
    expect(isTokenShape("../x")).toBe(false);
    expect(isTokenShape("A".repeat(42) + "+")).toBe(false);
  });

  it("limits at 30 per minute and 300 per hour, counting the current request", () => {
    expect(GUEST_LIMITS).toEqual({ perMinute: 30, perHour: 300 });
    expect(isGuestOverLimit({ lastMinute: 30, lastHour: 30 })).toBe(false);
    expect(isGuestOverLimit({ lastMinute: 31, lastHour: 31 })).toBe(true);
    expect(isGuestOverLimit({ lastMinute: 1, lastHour: 300 })).toBe(false);
    expect(isGuestOverLimit({ lastMinute: 1, lastHour: 301 })).toBe(true);
  });
});
