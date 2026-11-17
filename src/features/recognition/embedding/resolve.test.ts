import { describe, expect, it } from "vitest";
import { pickVerified } from "./resolve";
import { ORB_HIGH_INLIERS } from "./thresholds";

const m = (entries: [string, number][]) => new Map(entries);

describe("pickVerified", () => {
  it("is null when nothing was verified", () => {
    expect(pickVerified(m([]))).toBeNull();
  });

  it("picks the single candidate with strong geometric evidence", () => {
    expect(
      pickVerified(
        m([
          ["a", 300],
          ["b", 8],
          ["c", 4],
        ]),
      ),
    ).toEqual({
      gameId: "a",
      inliers: 300,
    });
  });

  it("needs the evidence to reach the high threshold", () => {
    expect(
      pickVerified(
        m([
          ["a", ORB_HIGH_INLIERS - 1],
          ["b", 2],
        ]),
      ),
    ).toBeNull();
    expect(pickVerified(m([["a", ORB_HIGH_INLIERS]]))).toEqual({
      gameId: "a",
      inliers: ORB_HIGH_INLIERS,
    });
  });

  it("refuses to pick when two candidates both have strong, comparable evidence", () => {
    expect(
      pickVerified(
        m([
          ["a", 120],
          ["b", 100],
        ]),
      ),
    ).toBeNull();
  });

  it("picks the leader when it has at least twice the evidence of the runner-up", () => {
    expect(
      pickVerified(
        m([
          ["a", 200],
          ["b", 100],
        ]),
      ),
    ).toMatchObject({ gameId: "a" });
    expect(
      pickVerified(
        m([
          ["a", 199],
          ["b", 100],
        ]),
      ),
    ).toBeNull();
  });

  it("an exact tie decides nothing", () => {
    expect(
      pickVerified(
        m([
          ["a", 150],
          ["b", 150],
        ]),
      ),
    ).toBeNull();
  });

  it("weak evidence on the others never blocks a strong winner", () => {
    expect(
      pickVerified(
        m([
          ["a", 80],
          ["b", 26],
          ["c", 17],
        ]),
      ),
    ).toMatchObject({
      gameId: "a",
    });
  });
});

import { decide, singleFrameLock } from "./resolve";
import type { Ranked } from "./rank";
import type { Lock } from "./vote";

const row = (gameId: string, score: number): Ranked => ({
  gameId,
  score,
  kind: "cover",
});
const lock = (gameId: string, similarity: number, margin: number): Lock => ({
  gameId,
  similarity,
  margin,
  votes: 3,
});

describe("singleFrameLock", () => {
  it("locks a clear leader from one frame", () => {
    expect(singleFrameLock([row("a", 0.8), row("b", 0.5)])).toMatchObject({
      gameId: "a",
    });
  });
  it("does not lock a weak or ambiguous frame, or nothing", () => {
    expect(singleFrameLock([row("a", 0.3), row("b", 0.1)])).toBeNull();
    expect(singleFrameLock([row("a", 0.7), row("b", 0.69)])).toBeNull();
    expect(singleFrameLock([])).toBeNull();
  });
});

describe("decide", () => {
  const ranked = [row("a", 0.7), row("b", 0.69), row("c", 0.3)];

  it("is null with neither verification nor a lock", () => {
    expect(decide({ ranked, orb: new Map(), lock: null })).toBeNull();
  });

  it("strong ORB evidence decides even when CLIP cannot (a tiny lead): high", () => {
    const d = decide({
      ranked,
      orb: new Map([
        ["a", 300],
        ["b", 4],
      ]),
      lock: null,
    });
    expect(d).toMatchObject({ gameId: "a", level: "high", via: "orb" });
  });

  it("ORB evidence can pick a game CLIP ranked second", () => {
    const d = decide({
      ranked,
      orb: new Map([
        ["a", 3],
        ["b", 200],
      ]),
      lock: null,
    });
    expect(d).toMatchObject({ gameId: "b", level: "high", via: "orb" });
  });

  it("two look-alikes with comparable ORB evidence and no lock: no answer", () => {
    expect(
      decide({
        ranked,
        orb: new Map([
          ["a", 120],
          ["b", 100],
        ]),
        lock: null,
      }),
    ).toBeNull();
  });

  it("a lock whose ORB evidence is not clearly ahead of a runner-up is never high", () => {
    // pickVerified refuses (45 < 2 x 30): the lock branch must not turn it into "high".
    const d = decide({
      ranked: [row("a", 0.8), row("b", 0.5)],
      orb: new Map([
        ["a", 45],
        ["b", 30],
      ]),
      lock: lock("a", 0.8, 0.3),
    });
    expect(d).toMatchObject({ gameId: "a", via: "clip" });
    expect(d?.level).not.toBe("high");
  });

  it("a lock without verification: the level comes from similarity and lead (never high)", () => {
    const d = decide({
      ranked: [row("a", 0.8), row("b", 0.5)],
      orb: new Map(),
      lock: lock("a", 0.8, 0.3),
    });
    expect(d).toMatchObject({ gameId: "a", via: "clip", level: "medium" });
  });

  it("a weak lock is low", () => {
    const d = decide({
      ranked: [row("a", 0.5), row("b", 0.46)],
      orb: new Map(),
      lock: lock("a", 0.5, 0.04),
    });
    expect(d).toMatchObject({ level: "low" });
  });

  it("verification of the locked game lifts it to high; a conflicting stronger ORB winner overrides the lock", () => {
    const base = {
      ranked: [row("a", 0.8), row("b", 0.5)],
      lock: lock("a", 0.8, 0.3),
    };
    expect(decide({ ...base, orb: new Map([["a", 90]]) })).toMatchObject({
      gameId: "a",
      level: "high",
    });
    expect(
      decide({
        ...base,
        orb: new Map([
          ["a", 5],
          ["b", 150],
        ]),
      }),
    ).toMatchObject({ gameId: "b", via: "orb" });
  });

  it("a learned barcode game is high and overrides everything", () => {
    const d = decide({
      ranked,
      orb: new Map([["a", 300]]),
      lock: lock("a", 0.7, 0.01),
      barcodeGameId: "c",
    });
    expect(d).toMatchObject({ gameId: "c", level: "high", via: "barcode" });
  });
});
