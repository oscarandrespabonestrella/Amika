import { describe, expect, it } from "vitest";
import { levelFor } from "./confidence";
import { ORB_HIGH_INLIERS, ORB_MEDIUM_INLIERS } from "./thresholds";

describe("levelFor", () => {
  it("a learned barcode is high whatever the picture says", () => {
    expect(levelFor({ learnedBarcode: true })).toBe("high");
  });

  it("a strong ORB verification is high", () => {
    expect(levelFor({ orbInliers: ORB_HIGH_INLIERS })).toBe("high");
  });

  it("a moderate ORB verification is medium", () => {
    expect(levelFor({ orbInliers: ORB_MEDIUM_INLIERS })).toBe("medium");
    expect(levelFor({ orbInliers: ORB_HIGH_INLIERS - 1 })).toBe("medium");
  });

  it("no or weak geometric evidence is low: the picture model alone is never enough", () => {
    // Measured with the 500-game pack (ADR-038): a box in NO reference still got a CLIP-only
    // similarity of 0.62-0.67 and a lead of 0.07 (ORB 0 and 26), a confident wrong answer.
    expect(levelFor({})).toBe("low");
    expect(levelFor({ orbInliers: 0 })).toBe("low");
    expect(levelFor({ orbInliers: 26 })).toBe("low");
    expect(levelFor({ orbInliers: ORB_MEDIUM_INLIERS - 1 })).toBe("low");
  });
});
