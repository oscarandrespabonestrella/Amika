// Pure. EVERY tunable number of the live recognition lives here, calibrated with the user's
// real photos (see docs/DECISIONS.md ADR-037). Change them only with a measurement.

/** Length of a CLIP ViT-B/32 image embedding. */
export const EMBED_DIM = 512;

/** A candidate locks when it is the leader in VOTE_MIN of the last VOTE_WINDOW frames. */
export const VOTE_WINDOW = 5;
export const VOTE_MIN = 3;

/** A frame only votes when its best similarity reaches this. */
export const LOCK_MIN_SIMILARITY = 0.45;
/** The leader's mean advantage over the runner-up must reach this to lock. */
export const LOCK_MIN_MARGIN = 0.02;

/** "medium" without ORB evidence needs both of these. */
export const MEDIUM_MIN_SIMILARITY = 0.55;
export const MEDIUM_MIN_MARGIN = 0.04;

/** ORB + RANSAC inliers (frame vs cover) that make an answer "high" / "medium". */
export const ORB_HIGH_INLIERS = 40;
export const ORB_MEDIUM_INLIERS = 15;
