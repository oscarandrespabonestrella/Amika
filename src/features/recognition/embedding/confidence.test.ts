import { describe, expect, it } from "vitest";
import { levelFor } from "./confidence";
import {
  MEDIUM_MIN_MARGIN,
  MEDIUM_MIN_SIMILARITY,
  ORB_HIGH_INLIERS,
  ORB_MEDIUM_INLIERS,
} from "./thresholds";

describe("levelFor", () => {
  it("a learned barcode is high whatever the picture says", () => {
    expect(levelFor({ similarity: 0.1, margin: 0, learnedBarcode: true })).toBe(
      "high",
    );
  });

  it("a strong ORB verification is high", () => {
    expect(
      levelFor({ similarity: 0.5, margin: 0.01, orbInliers: ORB_HIGH_INLIERS }),
    ).toBe("high");
  });

  it("a moderate ORB verification, or a clear similarity and margin, is medium", () => {
    expect(
      levelFor({ similarity: 0.2, margin: 0, orbInliers: ORB_MEDIUM_INLIERS }),
    ).toBe("medium");
    expect(
      levelFor({
        similarity: MEDIUM_MIN_SIMILARITY,
        margin: MEDIUM_MIN_MARGIN,
      }),
    ).toBe("medium");
  });

  it("is low otherwise", () => {
    expect(levelFor({ similarity: 0.4, margin: 0.3 })).toBe("low");
    expect(levelFor({ similarity: 0.9, margin: 0.001 })).toBe("low");
  });

  it("weak ORB evidence never makes it high, however good the similarity", () => {
    expect(levelFor({ similarity: 0.95, margin: 0.4, orbInliers: 3 })).toBe(
      "medium",
    );
    expect(levelFor({ similarity: 0.95, margin: 0.4 })).toBe("medium");
  });
});
