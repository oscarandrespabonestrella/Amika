import { describe, expect, it } from "vitest";
import { parseGtin } from "./gtin";

describe("parseGtin", () => {
  it("accepts an EAN-13 with a valid check digit", () => {
    expect(parseGtin("9783161484100")).toBe("9783161484100");
  });

  it("refuses a wrong check digit", () => {
    expect(parseGtin("9783161484101")).toBeNull();
  });

  it("normalizes UPC-A (12 digits) to 13 digits", () => {
    expect(parseGtin("036000291452")).toBe("0036000291452");
  });

  it("accepts EAN-8 and normalizes it to 13 digits", () => {
    expect(parseGtin("96385074")).toBe("0000096385074");
  });

  it("tolerates spaces and hyphens", () => {
    expect(parseGtin(" 978-3-16-148410-0 ")).toBe("9783161484100");
  });

  it("refuses garbage", () => {
    for (const raw of ["abc", "", "123", "123456789012345", "97831614841ab"])
      expect(parseGtin(raw), raw).toBeNull();
  });
});
