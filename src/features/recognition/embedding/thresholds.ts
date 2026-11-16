// Pure. EVERY tunable number of the live recognition lives here. Calibrated on 15 real
// photos of the user's boxes against 65 covers (docs/DECISIONS.md ADR-037); re-run
// `npm run recognition:eval` before changing any of them.
//
// What the measurement showed: a RIGHT top-1 has CLIP similarity 0.42-0.82 and ORB
// inliers 46-609 (one weak case: 5); a WRONG top-1 has similarity 0.57-0.67, a lead of
// 0.003-0.020 over the runner-up and at most 26 ORB inliers (look-alike covers, e.g.
// Catan vs its card game). So: ORB >= 40 is decisive, ORB 30-39 is already above every
// wrong answer, and a lead below 0.03 is never trusted without ORB evidence.

/** Length of a CLIP ViT-B/32 image embedding. */
export const EMBED_DIM = 512;

/** A candidate locks when it is the leader in VOTE_MIN of the last VOTE_WINDOW frames. */
export const VOTE_WINDOW = 5;
export const VOTE_MIN = 3;

/** A frame only votes when its best similarity reaches this. */
export const LOCK_MIN_SIMILARITY = 0.45;
/** The leader's mean advantage over the runner-up must reach this to lock. */
export const LOCK_MIN_MARGIN = 0.03;

/** "medium" without ORB evidence needs both of these. */
export const MEDIUM_MIN_SIMILARITY = 0.55;
export const MEDIUM_MIN_MARGIN = 0.05;

/** ORB + RANSAC inliers (frame vs cover) that make an answer "high" / "medium". */
export const ORB_HIGH_INLIERS = 40;
export const ORB_MEDIUM_INLIERS = 30;

/** Below this top similarity a frame looks like nothing in the catalog: no ORB is spent on it. */
export const VERIFY_MIN_SIMILARITY = 0.35;
