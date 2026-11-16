// Pure. How much to trust a locked candidate. Never "certain": the user always confirms.
import {
  MEDIUM_MIN_MARGIN,
  MEDIUM_MIN_SIMILARITY,
  ORB_HIGH_INLIERS,
  ORB_MEDIUM_INLIERS,
} from "./thresholds";

export type Level = "high" | "medium" | "low";

/**
 * "high" only with hard evidence: a barcode the user taught the app, or a strong
 * geometric verification (ORB + RANSAC inliers). The model's similarity alone, however
 * good, tops out at "medium".
 */
export function levelFor(input: {
  similarity: number;
  margin: number;
  orbInliers?: number;
  learnedBarcode?: boolean;
}): Level {
  if (input.learnedBarcode) return "high";
  const inliers = input.orbInliers ?? 0;
  if (inliers >= ORB_HIGH_INLIERS) return "high";
  if (
    inliers >= ORB_MEDIUM_INLIERS ||
    (input.similarity >= MEDIUM_MIN_SIMILARITY &&
      input.margin >= MEDIUM_MIN_MARGIN)
  )
    return "medium";
  return "low";
}
