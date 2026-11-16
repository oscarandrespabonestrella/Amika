import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOpenCv, verifyOrb, type Cv } from "./orb";

type Rgba = { data: Uint8ClampedArray; width: number; height: number };

/** Decoded RGBA pixels of a sharp pipeline. */
async function rgba(image: Sharp): Promise<Rgba> {
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  };
}

/** A feature-rich synthetic picture: random coloured blocks of several sizes. */
function texture(seed: number, size = 480) {
  const raw = Buffer.alloc(size * size * 3);
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const block of [64, 32, 16]) {
    const cols = Math.ceil(size / block);
    const tones = Array.from({ length: cols * cols }, () => [
      Math.floor(rand() * 255),
      Math.floor(rand() * 255),
      Math.floor(rand() * 255),
    ]);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        // only some cells of each layer are painted, so the layers overlap into detail
        const idx = Math.floor(y / block) * cols + Math.floor(x / block);
        if (idx % 3 === (block / 16) % 3) {
          const o = (y * size + x) * 3;
          raw[o] = tones[idx][0];
          raw[o + 1] = tones[idx][1];
          raw[o + 2] = tones[idx][2];
        }
      }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } });
}

let cv: Cv;

beforeAll(async () => {
  // OpenCV.js is loaded with require: awaiting a dynamic import() of it trips over its
  // thenable export. It is either a Promise, the ready module, or a module still starting.
  const candidate = createRequire(import.meta.url)("@techstark/opencv-js") as
    Cv | Promise<Cv> | (Cv & { onRuntimeInitialized?: () => void });
  if (candidate instanceof Promise) cv = await candidate;
  else if ((candidate as Cv).Mat) cv = candidate as Cv;
  else {
    await new Promise<void>((resolve) => {
      (
        candidate as { onRuntimeInitialized?: () => void }
      ).onRuntimeInitialized = resolve;
    });
    cv = candidate as Cv;
  }
}, 60_000);

describe("verifyOrb (OpenCV.js, ORB + RANSAC homography)", () => {
  it("counts many inliers for the same picture seen scaled, rotated, brighter and blurred", async () => {
    const cover = await rgba(texture(7));
    const view = await rgba(
      texture(7)
        .rotate(20, { background: "#808080" })
        .resize(300)
        .modulate({ brightness: 1.2 })
        .blur(0.8),
    );
    expect(verifyOrb(cv, view, cover)).toBeGreaterThanOrEqual(40);
  });

  it("counts almost nothing for an unrelated picture", async () => {
    const cover = await rgba(texture(7));
    const other = await rgba(texture(1234));
    const unrelated = verifyOrb(cv, other, cover);
    // Spurious matches of up to ~17 inliers also appear with real covers (measured): the
    // thresholds in thresholds.ts keep "medium" and "high" clear above that.
    expect(unrelated).toBeLessThanOrEqual(25);
    const same = verifyOrb(cv, await rgba(texture(7).resize(320)), cover);
    expect(same).toBeGreaterThan(unrelated * 3);
  });

  it("is 0, never a throw, for a flat picture or a tiny one", async () => {
    const cover = await rgba(texture(7));
    const flat = await rgba(
      sharp({
        create: { width: 200, height: 200, channels: 3, background: "#ffffff" },
      }),
    );
    expect(verifyOrb(cv, flat, cover)).toBe(0);
    expect(verifyOrb(cv, cover, flat)).toBe(0);
    const tiny: Rgba = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };
    expect(verifyOrb(cv, tiny, cover)).toBe(0);
  });

  it("deletes every OpenCV object it tracks, on every path (match, no match, flat, tiny)", async () => {
    const cover = await rgba(texture(7));
    const view = await rgba(texture(7).resize(320));
    const other = await rgba(texture(55));
    const flat = await rgba(
      sharp({
        create: { width: 100, height: 100, channels: 3, background: "#fff" },
      }),
    );
    const tiny: Rgba = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };
    const stats = { tracked: 0, deleted: 0 };
    for (let i = 0; i < 20; i++)
      for (const frame of [view, other, flat, tiny])
        verifyOrb(cv, frame, cover, { stats });
    expect(stats.tracked).toBeGreaterThan(100);
    expect(stats.deleted).toBe(stats.tracked);
  });

  it("every OpenCV allocation in orb.ts goes through the tracker (static guard)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/features/recognition/verify/orb.ts"),
      "utf8",
    );
    const allocations = source.match(
      /new cv\.(Mat|ORB|KeyPointVector|BFMatcher|DMatchVectorVector)\(|cv\.(matFromArray|findHomography)\(/g,
    );
    const tracked = source.match(
      /track\(\s*(new cv\.(Mat|ORB|KeyPointVector|BFMatcher|DMatchVectorVector)\(|cv\.(matFromArray|findHomography)\()/g,
    );
    expect(allocations?.length).toBeGreaterThan(5);
    expect(tracked?.length).toBe(allocations?.length);
  });

  it("keeps the vector, matcher and ORB objects balanced (constructed = deleted)", async () => {
    type Klass = { prototype: { delete(): void } };
    const api = cv as unknown as Record<string, unknown>;
    const alive: Record<string, number> = {};
    const bump = (name: string, by: number) =>
      (alive[name] = (alive[name] ?? 0) + by);
    for (const name of [
      "ORB",
      "KeyPointVector",
      "BFMatcher",
      "DMatchVectorVector",
      "DMatchVector",
    ]) {
      const Original = api[name] as Klass;
      const del = Original.prototype.delete;
      Original.prototype.delete = function (this: unknown) {
        bump(name, -1);
        return del.call(this);
      };
      api[name] = new Proxy(Original as unknown as object, {
        construct(target, args) {
          bump(name, 1);
          return Reflect.construct(
            target as new (...a: unknown[]) => object,
            args,
          );
        },
      });
    }
    // knn.get(i) returns a DMatchVector the code must delete: count it as created.
    const vectors = (
      api.DMatchVectorVector as unknown as {
        prototype: { get(i: number): unknown };
      }
    ).prototype;
    const originalGet = vectors.get;
    vectors.get = function (this: unknown, i: number) {
      bump("DMatchVector", 1);
      return originalGet.call(this, i);
    };

    const cover = await rgba(texture(7));
    for (let i = 0; i < 10; i++) {
      verifyOrb(cv, await rgba(texture(7).resize(320)), cover);
      verifyOrb(cv, await rgba(texture(55)), cover);
    }
    expect(
      Object.fromEntries(Object.entries(alive).filter(([, n]) => n !== 0)),
    ).toEqual({});
  });
});

describe("loadOpenCv", () => {
  type FakeScript = {
    src: string;
    onload?: () => void;
    onerror?: () => void;
    async?: boolean;
  };
  const fakeDoc = (
    behaviour: "load" | "error" | "silent",
    win: { cv?: unknown },
  ) => {
    const scripts: FakeScript[] = [];
    return {
      scripts,
      doc: {
        createElement: () => ({}) as FakeScript,
        head: {
          appendChild(s: FakeScript) {
            scripts.push(s);
            queueMicrotask(() => {
              if (behaviour === "load") {
                win.cv = { Mat: function Mat() {} };
                s.onload?.();
              } else if (behaviour === "error") s.onerror?.();
            });
          },
        },
      },
    };
  };

  it("injects /opencv/opencv.js once and resolves with cv; a second call reuses it", async () => {
    const win: { cv?: unknown } = {};
    const { doc, scripts } = fakeDoc("load", win);
    const a = await loadOpenCv({ doc, win });
    const b = await loadOpenCv({ doc, win });
    expect(a).toBe(b);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe("/opencv/opencv.js");
  });

  it("rejects when the script cannot be loaded, and can be retried afterwards", async () => {
    const win: { cv?: unknown } = {};
    const bad = fakeDoc("error", win);
    await expect(
      loadOpenCv({ doc: bad.doc, win, fresh: true }),
    ).rejects.toThrow();
    const good = fakeDoc("load", win);
    await expect(
      loadOpenCv({ doc: good.doc, win, fresh: true }),
    ).resolves.toBeDefined();
  });

  it("rejects on timeout", async () => {
    const win: { cv?: unknown } = {};
    const silent = fakeDoc("silent", win);
    await expect(
      loadOpenCv({ doc: silent.doc, win, timeoutMs: 20, fresh: true }),
    ).rejects.toThrow(/time/i);
  });
});
