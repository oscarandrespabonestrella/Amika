import { describe, expect, it } from "vitest";
import { pickGtin } from "./barcode";

describe("pickGtin", () => {
  it("returns the first value with a valid check digit, normalized to 13 digits", () => {
    expect(pickGtin(["nonsense", "036000291452", "9783161484100"])).toBe(
      "0036000291452",
    );
  });
  it("is null when nothing is a valid GTIN", () => {
    expect(pickGtin([])).toBeNull();
    expect(pickGtin(["", "123", "9783161484101"])).toBeNull();
  });
});
