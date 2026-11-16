import { describe, expect, it, vi } from "vitest";
import { normalize, type Reference, type Vec } from "../embedding/rank";
import { EMBED_DIM } from "../embedding/thresholds";
import { createSession, type SessionDeps } from "./session";

const axis = (i: number): Vec => {
  const v = new Array(EMBED_DIM).fill(0);
  v[i] = 1;
  return normalize(v);
};
/** A query that is `a` fraction of axis i and the rest of axis j (cosine to i = a/norm). */
const mix = (i: number, a: number, j: number, b: number): Vec => {
  const v = new Array(EMBED_DIM).fill(0);
  v[i] = a;
  v[j] = b;
  return normalize(v);
};

const A = 0;
const B = 1;
const C = 2;
const refs: Reference[] = [
  { gameId: "a", vec: axis(A), kind: "cover" },
  { gameId: "b", vec: axis(B), kind: "cover" },
  { gameId: "c", vec: axis(C), kind: "cover" },
];
const frame = { data: new Uint8ClampedArray(4), width: 1, height: 1 };

function harness(over: Partial<SessionDeps> & { vec?: () => Vec } = {}) {
  let t = 0;
  const deps = {
    embed: vi.fn(async () => (over.vec ? over.vec() : axis(A))),
    readBarcode: vi.fn(async () => null as string | null),
    lookupBarcode: vi.fn(async () => null as string | null),
    verify: vi.fn(async () => 0),
    now: () => t,
    ...over,
  } as SessionDeps & { [K in keyof SessionDeps]: ReturnType<typeof vi.fn> };
  const session = createSession(deps, {
    verifyEveryMs: 1500,
    barcodeEveryMs: 1500,
  });
  session.setReferences(refs);
  const advance = (ms: number) => (t += ms);
  return { deps, session, advance };
}

describe("createSession", () => {
  it("strong ORB evidence answers on the very first frame: high, via orb", async () => {
    const { session } = harness({
      verify: vi.fn(async (_f, id) => (id === "a" ? 300 : 4)),
    });
    const u = await session.tick(frame);
    expect(u.decision).toMatchObject({
      gameId: "a",
      level: "high",
      via: "orb",
    });
    expect(u.candidates[0]).toMatchObject({ gameId: "a" });
  });

  it("without ORB evidence, a stable CLIP lock appears on the third agreeing frame (never high)", async () => {
    const { session, advance } = harness({ vec: () => mix(A, 0.9, B, 0.3) });
    const first = await session.tick(frame);
    advance(500);
    const second = await session.tick(frame);
    advance(500);
    const third = await session.tick(frame);
    expect(first.decision).toBeNull();
    expect(second.decision).toBeNull();
    expect(third.decision).toMatchObject({ gameId: "a", via: "clip" });
    expect(third.decision?.level).not.toBe("high");
  });

  it("ORB resolves two nearly tied covers that CLIP cannot separate", async () => {
    const { session } = harness({
      vec: () => mix(A, 1, B, 0.99),
      verify: vi.fn(async (_f, id) => (id === "a" ? 250 : 5)),
    });
    expect((await session.tick(frame)).decision).toMatchObject({
      gameId: "a",
      via: "orb",
    });
  });

  it("two look-alikes with comparable ORB evidence give no answer", async () => {
    const { session } = harness({
      vec: () => mix(A, 1, B, 0.99),
      verify: vi.fn(async (_f, id) =>
        id === "a" ? 120 : id === "b" ? 100 : 0,
      ),
    });
    expect((await session.tick(frame)).decision).toBeNull();
  });

  it("verifies at most once per interval, not on every frame", async () => {
    const { session, deps, advance } = harness({
      vec: () => mix(A, 0.9, B, 0.3),
    });
    for (let i = 0; i < 7; i++) {
      await session.tick(frame);
      advance(500);
    }
    // ticks at t = 0 .. 3000: verification rounds at t = 0, 1500, 3000 (3 candidates each)
    expect(deps.verify.mock.calls.length).toBe(9);
  });

  it("never verifies a frame that looks like nothing in the catalog", async () => {
    const { session, deps } = harness({ vec: () => mix(A, 0.1, 50, 1) });
    const u = await session.tick(frame);
    expect(deps.verify).not.toHaveBeenCalled();
    expect(u.decision).toBeNull();
  });

  it("a learned barcode answers immediately with high confidence, via barcode", async () => {
    const { session } = harness({
      readBarcode: vi.fn(async () => "9783161484100"),
      lookupBarcode: vi.fn(async () => "c"),
    });
    const u = await session.tick(frame);
    expect(u.decision).toMatchObject({
      gameId: "c",
      level: "high",
      via: "barcode",
    });
    expect(u.gtin).toBe("9783161484100");
  });

  it("an unknown barcode is reported (so it can be taught) but does not answer", async () => {
    const { session } = harness({
      vec: () => mix(A, 0.1, 50, 1),
      readBarcode: vi.fn(async () => "9783161484100"),
    });
    const u = await session.tick(frame);
    expect(u.gtin).toBe("9783161484100");
    expect(u.decision).toBeNull();
  });

  it("reads the barcode only every interval, and looks each new code up once", async () => {
    const { session, deps, advance } = harness({
      readBarcode: vi.fn(async () => "9783161484100"),
    });
    for (let i = 0; i < 7; i++) {
      await session.tick(frame);
      advance(500);
    }
    expect(deps.readBarcode.mock.calls.length).toBe(3);
    expect(deps.lookupBarcode.mock.calls.length).toBe(1);
  });

  it("a barcode answer expires when the code is no longer in view", async () => {
    let seen: string | null = "9783161484100";
    const { session, advance } = harness({
      vec: () => mix(A, 0.1, 50, 1),
      readBarcode: vi.fn(async () => seen),
      lookupBarcode: vi.fn(async () => "c"),
    });
    expect((await session.tick(frame)).decision).toMatchObject({
      via: "barcode",
    });
    seen = null;
    advance(5000);
    expect((await session.tick(frame)).decision).toBeNull();
  });

  it("exclude() removes a game from every future answer and resets the vote", async () => {
    const { session } = harness({
      verify: vi.fn(async (_f, id) => (id === "a" ? 300 : 4)),
    });
    expect((await session.tick(frame)).decision?.gameId).toBe("a");
    session.exclude("a");
    const u = await session.tick(frame);
    expect(u.candidates.map((c) => c.gameId)).not.toContain("a");
    expect(u.decision?.gameId).not.toBe("a");
  });

  it("has no answer, and does not crash, with no references", async () => {
    const { session } = harness();
    session.setReferences([]);
    const u = await session.tick(frame);
    expect(u.candidates).toEqual([]);
    expect(u.decision).toBeNull();
  });

  it("survives a failing ORB verification or barcode reader (treated as no evidence)", async () => {
    const { session } = harness({
      vec: () => mix(A, 0.9, B, 0.3),
      verify: vi.fn(async () => {
        throw new Error("opencv blew up");
      }),
      readBarcode: vi.fn(async () => {
        throw new Error("no detector");
      }),
    });
    await expect(session.tick(frame)).resolves.toMatchObject({
      decision: null,
    });
  });

  it("lets an embedding failure reach the caller (the hook decides what to show)", async () => {
    const { session } = harness({
      embed: vi.fn(async () => {
        throw new Error("model gone");
      }),
    });
    await expect(session.tick(frame)).rejects.toThrow("model gone");
  });

  it("reset() forgets votes, verification and barcode state", async () => {
    const { session, advance } = harness({ vec: () => mix(A, 0.9, B, 0.3) });
    await session.tick(frame);
    advance(500);
    await session.tick(frame);
    session.reset();
    advance(500);
    expect((await session.tick(frame)).decision).toBeNull(); // the votes start over
  });

  it("returns the frame's vector so a confirmed frame can be learned", async () => {
    const v = mix(A, 0.9, B, 0.3);
    const { session } = harness({ vec: () => v });
    expect((await session.tick(frame)).vec).toBe(v);
  });
});

describe("createSession().analyze (one photo, no vote)", () => {
  it("answers a photo with strong ORB evidence at once, ignoring any throttling", async () => {
    const { session, deps } = harness({
      verify: vi.fn(async (_f, id) => (id === "a" ? 300 : 4)),
    });
    await session.tick(frame); // consumes the throttled verification round
    const u = await session.analyze(frame);
    expect(u.decision).toMatchObject({
      gameId: "a",
      level: "high",
      via: "orb",
    });
    expect(deps.verify.mock.calls.length).toBeGreaterThanOrEqual(6); // 3 + 3
  });

  it("locks a clear CLIP leader from the single photo (medium, never high without evidence)", async () => {
    const { session } = harness({ vec: () => mix(A, 0.9, B, 0.3) });
    const u = await session.analyze(frame);
    expect(u.decision).toMatchObject({ gameId: "a", via: "clip" });
    expect(u.decision?.level).not.toBe("high");
  });

  it("gives no answer for an ambiguous or unrecognizable photo", async () => {
    expect(
      (await harness({ vec: () => mix(A, 1, B, 0.99) }).session.analyze(frame))
        .decision,
    ).toBeNull();
    expect(
      (await harness({ vec: () => mix(A, 0.1, 50, 1) }).session.analyze(frame))
        .decision,
    ).toBeNull();
  });

  it("does not touch the live vote and respects exclusions", async () => {
    const { session } = harness({ vec: () => mix(A, 0.9, B, 0.3) });
    session.exclude("a");
    const u = await session.analyze(frame);
    expect(u.candidates.map((c) => c.gameId)).not.toContain("a");
  });
});
