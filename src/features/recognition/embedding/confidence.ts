// Pure. How much to trust a locked candidate. Never "certain": the user always confirms.
import { ORB_HIGH_INLIERS, ORB_MEDIUM_INLIERS } from "./thresholds";

export type Level = "high" | "medium" | "low";

/**
 * "high" and "medium" need hard evidence: a barcode the user taught the app, or a
 * geometric verification (ORB + RANSAC inliers). The picture model's similarity and lead,
 * however good, never go beyond "low": with the 500-game pack a box that is in NO
 * reference still scored 0.62-0.67 with a lead of 0.07 (ADR-038), which would have been a
 * confident wrong answer.
 */
export function levelFor(input: {
  orbInliers?: number;
  learnedBarcode?: boolean;
}): Level {
  if (input.learnedBarcode) return "high";
  const inliers = input.orbInliers ?? 0;
  if (inliers >= ORB_HIGH_INLIERS) return "high";
  if (inliers >= ORB_MEDIUM_INLIERS) return "medium";
  return "low";
}
