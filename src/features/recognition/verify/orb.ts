// Browser (and Node, for tests and the evaluation harness): geometric verification with
// OpenCV.js. ORB features + ratio test + RANSAC homography. The number of INLIERS is
// strong evidence that two pictures show the same object (hundreds for a true match, a
// handful for unrelated ones), which is what lets an answer be "high" confidence.
import type CV from "@techstark/opencv-js";

export type Cv = typeof CV;

export type RgbaImage = {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
};

const MAX_SIDE = 640;
const MIN_SIDE = 16;
const MIN_MATCHES = 8;

type Deletable = { delete(): void };

// --- loading ------------------------------------------------------------------------

type ScriptEl = {
  src: string;
  async?: boolean;
  onload?: (() => void) | null;
  onerror?: (() => void) | null;
};
type DocLike = {
  createElement(tag: "script"): ScriptEl;
  head: { appendChild(el: ScriptEl): unknown };
};
type WinLike = { cv?: unknown };

let cached: Promise<Cv> | null = null;

/**
 * Loads /opencv/opencv.js (our own copy) once, as a classic script, and resolves with
 * `cv` when its runtime is ready. A failure is not cached, so it can be retried.
 */
export function loadOpenCv(
  opts: {
    doc?: DocLike;
    win?: WinLike;
    timeoutMs?: number;
    /** Tests: ignore and do not touch the shared cache. */
    fresh?: boolean;
  } = {},
): Promise<Cv> {
  if (!opts.fresh && cached) return cached;
  const doc = opts.doc ?? (document as unknown as DocLike);
  const win = opts.win ?? (window as unknown as WinLike);

  const promise = new Promise<Cv>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("OpenCV took too long to load (time out)")),
      opts.timeoutMs ?? 30_000,
    );
    const script = doc.createElement("script");
    script.src = "/opencv/opencv.js";
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("OpenCV could not be loaded"));
    };
    script.onload = async () => {
      try {
        const found = win.cv as
          (Cv & { onRuntimeInitialized?: () => void }) | Promise<Cv>;
        if (found instanceof Promise) resolve(await found);
        else if (found?.Mat) resolve(found as Cv);
        else
          await new Promise<void>((ready) => {
            (
              found as { onRuntimeInitialized?: () => void }
            ).onRuntimeInitialized = ready;
          }).then(() => resolve(found as Cv));
      } catch (error) {
        reject(error);
      } finally {
        clearTimeout(timer);
      }
    };
    doc.head.appendChild(script);
  });

  if (opts.fresh) return promise;
  cached = promise;
  promise.catch(() => {
    if (cached === promise) cached = null; // allow a retry
  });
  return promise;
}

// --- verification -------------------------------------------------------------------

type Described = { des: CV.Mat; points: number[][] };

function describe(
  cv: Cv,
  image: RgbaImage,
  features: number,
  track: <T extends Deletable>(o: T) => T,
): Described | null {
  if (image.width < MIN_SIDE || image.height < MIN_SIDE) return null;
  const rgba = track(new cv.Mat(image.height, image.width, cv.CV_8UC4));
  rgba.data.set(image.data);
  let gray = track(new cv.Mat());
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);

  const longest = Math.max(image.width, image.height);
  if (longest > MAX_SIDE) {
    const scale = MAX_SIDE / longest;
    const small = track(new cv.Mat());
    cv.resize(
      gray,
      small,
      new cv.Size(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      ),
      0,
      0,
      cv.INTER_AREA,
    );
    gray = small;
  }

  const orb = track(new cv.ORB(features));
  const keypoints = track(new cv.KeyPointVector());
  const des = track(new cv.Mat());
  orb.detectAndCompute(gray, track(new cv.Mat()), keypoints, des);

  const points: number[][] = [];
  for (let i = 0; i < keypoints.size(); i++) {
    const k = keypoints.get(i);
    points.push([k.pt.x, k.pt.y]);
    (k as unknown as Partial<Deletable>).delete?.();
  }
  return des.rows >= MIN_MATCHES ? { des, points } : null;
}

/**
 * Inlier count of the best homography between `frame` and `cover` (0 when there are too
 * few good matches or no homography). Every OpenCV object is deleted in `finally`.
 */
export function verifyOrb(
  cv: Cv,
  frame: RgbaImage,
  cover: RgbaImage,
  opts: {
    features?: number;
    ratio?: number;
    reprojection?: number;
    /** Tests: how many OpenCV objects were tracked and how many were deleted. */
    stats?: { tracked: number; deleted: number };
  } = {},
): number {
  const features = opts.features ?? 1500;
  const ratio = opts.ratio ?? 0.75;
  const reprojection = opts.reprojection ?? 5;

  const garbage: Deletable[] = [];
  const track = <T extends Deletable>(o: T): T => {
    garbage.push(o);
    if (opts.stats) opts.stats.tracked++;
    return o;
  };

  try {
    const a = describe(cv, frame, features, track);
    const b = describe(cv, cover, features, track);
    if (!a || !b) return 0;

    const matcher = track(new cv.BFMatcher(cv.NORM_HAMMING, false));
    const knn = track(new cv.DMatchVectorVector());
    matcher.knnMatch(a.des, b.des, knn, 2);

    const src: number[] = [];
    const dst: number[] = [];
    for (let i = 0; i < knn.size(); i++) {
      const pair = knn.get(i);
      if (pair.size() >= 2) {
        const m0 = pair.get(0);
        const m1 = pair.get(1);
        if (m0.distance < ratio * m1.distance) {
          src.push(...a.points[m0.queryIdx]);
          dst.push(...b.points[m0.trainIdx]);
        }
        (m0 as unknown as Partial<Deletable>).delete?.();
        (m1 as unknown as Partial<Deletable>).delete?.();
      }
      pair.delete();
    }
    const matches = src.length / 2;
    if (matches < MIN_MATCHES) return 0;

    const from = track(cv.matFromArray(matches, 1, cv.CV_32FC2, src));
    const to = track(cv.matFromArray(matches, 1, cv.CV_32FC2, dst));
    const mask = track(new cv.Mat());
    const homography = track(
      cv.findHomography(from, to, cv.RANSAC, reprojection, mask),
    );
    if (homography.empty()) return 0;
    let inliers = 0;
    for (let i = 0; i < mask.rows; i++) if (mask.data[i]) inliers++;
    return inliers;
  } catch {
    return 0;
  } finally {
    for (const o of garbage.reverse()) {
      try {
        o.delete();
        if (opts.stats) opts.stats.deleted++;
      } catch {
        // already deleted
      }
    }
  }
}
