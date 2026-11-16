// The brain of the live camera: one `tick(frame)` turns a camera frame into an answer.
// frame -> CLIP vector -> cosine ranking -> vote -> (throttled) ORB verification of the
// top 3 -> (throttled) barcode -> `decide`. All the heavy parts are injected, so the
// orchestration is unit tested without a camera, a model or OpenCV.
import { rankByCosine, type Reference, type Vec } from "../embedding/rank";
import { decide, singleFrameLock, type Decision } from "../embedding/resolve";
import { VERIFY_MIN_SIMILARITY } from "../embedding/thresholds";
import { createVoter } from "../embedding/vote";

export type Frame = {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
};

export type SessionDeps = {
  /** The CLIP vector of a frame (the worker). Failures propagate to the caller. */
  embed(frame: Frame): Promise<Vec>;
  /** A valid GTIN in the frame, or null. Failures are ignored. */
  readBarcode(frame: Frame): Promise<string | null>;
  /** The game the USER taught for this barcode, or null. */
  lookupBarcode(gtin: string): Promise<string | null>;
  /** ORB inliers of the frame against the cover of a game. Failures count as 0. */
  verify(frame: Frame, gameId: string): Promise<number>;
  now(): number;
};

export type Candidate = { gameId: string; similarity: number };

export type Update = {
  /** The three best by similarity (excluded games removed). */
  candidates: Candidate[];
  /** What to tell the user, or null for "not sure yet". */
  decision: Decision | null;
  /** The frame's vector (to learn it if the user confirms). */
  vec: Vec;
  /** The barcode in view, known or not (an unknown one can be taught). */
  gtin: string | null;
};

const TOP_N = 3;
const ORB_TTL_MS = 3000;
const BARCODE_TTL_MS = 4000;

export function createSession(
  deps: SessionDeps,
  config: { verifyEveryMs?: number; barcodeEveryMs?: number } = {},
) {
  const verifyEveryMs = config.verifyEveryMs ?? 1500;
  const barcodeEveryMs = config.barcodeEveryMs ?? 1500;

  let refs: Reference[] = [];
  const excluded = new Set<string>();
  let voter = createVoter();

  let lastVerifyAt = -Infinity;
  let orb = new Map<string, { inliers: number; at: number }>();

  let lastBarcodeAt = -Infinity;
  const barcodeGames = new Map<string, string | null>(); // gtin -> taught game
  let barcode: { gtin: string; at: number } | null = null;

  const clearEvidence = () => {
    voter = createVoter();
    orb = new Map();
    lastVerifyAt = -Infinity;
    barcode = null;
  };

  return {
    setReferences(next: Reference[]) {
      refs = next;
    },

    exclude(gameId: string) {
      excluded.add(gameId);
      clearEvidence();
    },

    reset() {
      clearEvidence();
    },

    /**
     * One photo, no vote: ORB verifies the top 3 right away (no throttling) and a single
     * frame must clear the lock thresholds on its own. Used by "choose a photo instead".
     */
    async analyze(frame: Frame): Promise<Update> {
      const vec = await deps.embed(frame);
      const ranked = rankByCosine(
        vec,
        refs.filter((r) => !excluded.has(r.gameId)),
      );
      const top = ranked.slice(0, TOP_N);
      const evidence = new Map<string, number>();
      if (top[0] && top[0].score >= VERIFY_MIN_SIMILARITY)
        for (const c of top) {
          try {
            evidence.set(c.gameId, await deps.verify(frame, c.gameId));
          } catch {
            evidence.set(c.gameId, 0);
          }
        }
      return {
        candidates: top.map((c) => ({ gameId: c.gameId, similarity: c.score })),
        decision: decide({
          ranked,
          orb: evidence,
          lock: singleFrameLock(ranked),
        }),
        vec,
        gtin: null,
      };
    },

    async tick(frame: Frame): Promise<Update> {
      const now = deps.now();
      const vec = await deps.embed(frame);
      const ranked = rankByCosine(
        vec,
        refs.filter((r) => !excluded.has(r.gameId)),
      );
      const top = ranked.slice(0, TOP_N);
      const lock = voter.push(ranked);

      // Barcode: throttled; each new code is looked up once.
      if (now - lastBarcodeAt >= barcodeEveryMs) {
        lastBarcodeAt = now;
        let gtin: string | null = null;
        try {
          gtin = await deps.readBarcode(frame);
        } catch {
          gtin = null;
        }
        if (gtin) {
          if (!barcodeGames.has(gtin)) {
            try {
              barcodeGames.set(gtin, await deps.lookupBarcode(gtin));
            } catch {
              barcodeGames.set(gtin, null);
            }
          }
          barcode = { gtin, at: now };
        }
      }
      const seen =
        barcode && now - barcode.at <= BARCODE_TTL_MS ? barcode : null;
      const taught = seen ? (barcodeGames.get(seen.gtin) ?? null) : null;

      // ORB verification of the top 3: throttled, and only when the frame looks like
      // something in the catalog.
      if (
        top[0] &&
        top[0].score >= VERIFY_MIN_SIMILARITY &&
        now - lastVerifyAt >= verifyEveryMs
      ) {
        lastVerifyAt = now;
        for (const c of top) {
          let inliers = 0;
          try {
            inliers = await deps.verify(frame, c.gameId);
          } catch {
            inliers = 0;
          }
          orb.set(c.gameId, { inliers, at: now });
        }
      }
      const fresh = new Map<string, number>();
      for (const c of top) {
        const e = orb.get(c.gameId);
        if (e && now - e.at <= ORB_TTL_MS) fresh.set(c.gameId, e.inliers);
      }

      return {
        candidates: top.map((c) => ({ gameId: c.gameId, similarity: c.score })),
        decision: decide({
          ranked,
          orb: fresh,
          lock,
          barcodeGameId: taught && !excluded.has(taught) ? taught : null,
        }),
        vec,
        gtin: seen?.gtin ?? null,
      };
    },
  };
}
