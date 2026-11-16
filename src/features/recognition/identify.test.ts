import { describe, expect, it, vi } from "vitest";
import { identifyGame, type IdentifyDeps } from "./identify";
import { mapRecognitionError } from "./errors";

const HASH = "0123456789abcdef";

function deps(over: Partial<IdentifyDeps> = {}) {
  return {
    findBarcode: vi.fn(async () => null),
    searchLocal: vi.fn(async () => []),
    searchExternal: vi.fn(async () => ({ ok: true as const, hits: [] })),
    matchImages: vi.fn(async () => []),
    gameNames: vi.fn(async () => new Map<string, string>()),
    ...over,
  } as IdentifyDeps & Record<keyof IdentifyDeps, ReturnType<typeof vi.fn>>;
}

describe("identifyGame", () => {
  it("a learned barcode alone gives one candidate with reason 'code'", async () => {
    const d = deps({
      findBarcode: vi.fn(async () => ({ gameId: "g1", name: "Wingspan" })),
    });
    const out = await identifyGame({ gtin: "9783161484100", lines: [] }, d);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]).toMatchObject({
      gameId: "g1",
      reasons: ["code"],
    });
    expect(out.candidates[0].score).toBeCloseTo(0.95, 5);
    expect(d.searchExternal).not.toHaveBeenCalled();
  });

  it("an unknown barcode contributes nothing (and is not an error)", async () => {
    const out = await identifyGame(
      { gtin: "9783161484100", lines: [] },
      deps(),
    );
    expect(out).toEqual({ candidates: [], bggLimited: false });
  });

  it("a strong local title match makes ZERO BGG calls", async () => {
    const d = deps({
      searchLocal: vi.fn(async () => [{ id: "g1", name: "Wingspan" }]),
    });
    const out = await identifyGame({ lines: ["WINGSPAN"] }, d);
    expect(d.searchExternal).not.toHaveBeenCalled();
    expect(out.candidates[0]).toMatchObject({
      gameId: "g1",
      reasons: ["title"],
    });
  });

  it("with no strong local match it makes at most 2 BGG searches, for the first two lines", async () => {
    const d = deps();
    await identifyGame({ lines: ["Alpha game", "Beta game", "Gamma game"] }, d);
    expect(d.searchExternal).toHaveBeenCalledTimes(2);
    expect(d.searchExternal.mock.calls.map((c) => c[0])).toEqual([
      "Alpha game",
      "Beta game",
    ]);
  });

  it("BGG hits become candidates; one already in the catalog merges with the local hit", async () => {
    const d = deps({
      searchLocal: vi.fn(async () => [{ id: "g9", name: "Catan Junior" }]),
      searchExternal: vi.fn(async () => ({
        ok: true as const,
        hits: [
          { externalId: "13", name: "Catan", gameId: null },
          { externalId: "99", name: "Catan Junior", gameId: "g9" },
        ],
      })),
    });
    const out = await identifyGame({ lines: ["Catan"] }, d);
    const names = out.candidates.map((c) => c.name);
    expect(names).toContain("Catan");
    expect(names.filter((n) => n === "Catan Junior")).toHaveLength(1);
    expect(out.candidates.find((c) => c.name === "Catan")).toMatchObject({
      gameId: null,
      externalId: "13",
    });
  });

  it("rate limited or unavailable BGG degrades to the other signals with bggLimited", async () => {
    for (const error of ["rate_limited", "unavailable"] as const) {
      const d = deps({
        searchExternal: vi.fn(async () => ({ ok: false as const, error })),
        matchImages: vi.fn(async () => [{ gameId: "g1", distance: 0 }]),
        gameNames: vi.fn(async () => new Map([["g1", "Wingspan"]])),
      });
      const out = await identifyGame(
        { lines: ["Alpha game", "Beta game"], hash: HASH },
        d,
      );
      expect(out.bggLimited, error).toBe(true);
      expect(d.searchExternal, error).toHaveBeenCalledTimes(1); // stops at the first refusal
      expect(out.candidates[0]).toMatchObject({
        gameId: "g1",
        reasons: ["image"],
      });
    }
  });

  it("another BGG failure is ignored quietly (not flagged as a limit)", async () => {
    const d = deps({
      searchExternal: vi.fn(async () => ({
        ok: false as const,
        error: "failed",
      })),
    });
    const out = await identifyGame({ lines: ["Alpha game"] }, d);
    expect(out).toEqual({ candidates: [], bggLimited: false });
  });

  it("an image match alone never scores above 0.35", async () => {
    const d = deps({
      matchImages: vi.fn(async () => [{ gameId: "g1", distance: 0 }]),
      gameNames: vi.fn(async () => new Map([["g1", "Azul"]])),
    });
    const out = await identifyGame({ hash: HASH }, d);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].score).toBeLessThanOrEqual(0.35);
    expect(out.candidates[0].reasons).toEqual(["image"]);
  });

  it("a nearer picture scores higher than a farther one", async () => {
    const d = deps({
      matchImages: vi.fn(async () => [
        { gameId: "g1", distance: 2 },
        { gameId: "g2", distance: 10 },
      ]),
      gameNames: vi.fn(
        async () =>
          new Map([
            ["g1", "Near"],
            ["g2", "Far"],
          ]),
      ),
    });
    const out = await identifyGame({ hash: HASH }, d);
    expect(out.candidates.map((c) => c.name)).toEqual(["Near", "Far"]);
  });

  it("title and picture agreeing on the same game rank it first", async () => {
    const d = deps({
      searchLocal: vi.fn(async () => [
        { id: "g1", name: "Wingspan" },
        { id: "g2", name: "Wingspan Asia" },
      ]),
      matchImages: vi.fn(async () => [{ gameId: "g1", distance: 1 }]),
      gameNames: vi.fn(async () => new Map([["g1", "Wingspan"]])),
    });
    const out = await identifyGame({ lines: ["Wingspan"], hash: HASH }, d);
    expect(out.candidates[0]).toMatchObject({
      gameId: "g1",
      reasons: ["title", "image"],
    });
  });

  it("garbage lines never throw and produce no invented certainty", async () => {
    const d = deps();
    for (const line of [
      "💥💥💥",
      "x".repeat(80),
      "<img src=x onerror=alert(1)>",
      "'; drop table games; --",
    ]) {
      const out = await identifyGame({ lines: [line] }, d);
      expect(out.candidates).toEqual([]);
    }
  });

  it("a weak textual match scores by its real similarity, below a strong one", async () => {
    const d = deps({
      searchLocal: vi.fn(async () => [
        { id: "g1", name: "Wingspan" },
        { id: "g2", name: "Wingspan: the long expansion of many things" },
      ]),
    });
    const out = await identifyGame({ lines: ["Wingspan"] }, d);
    const [strong, weak] = out.candidates;
    expect(strong.name).toBe("Wingspan");
    expect(strong.score).toBeCloseTo(0.7, 5);
    expect(weak.score).toBeGreaterThan(0);
    expect(weak.score).toBeLessThan(strong.score);
  });

  it("a hit with nothing in common is not a candidate at all", async () => {
    const d = deps({
      searchLocal: vi.fn(async () => [{ id: "g1", name: "Azul" }]),
    });
    const out = await identifyGame({ lines: ["completely different text"] }, d);
    expect(out.candidates).toEqual([]);
  });

  it("limits the answer to five candidates", async () => {
    const hits = Array.from({ length: 9 }, (_, i) => ({
      id: `g${i}`,
      name: `Game ${i}`,
    }));
    const d = deps({ searchLocal: vi.fn(async () => hits) });
    const out = await identifyGame({ lines: ["Game"] }, d);
    expect(out.candidates).toHaveLength(5);
  });
});

describe("mapRecognitionError", () => {
  it("maps database codes to stable error codes", () => {
    expect(mapRecognitionError("P0001")).toBe("limit");
    for (const code of ["42501", "23503", "P0002"])
      expect(mapRecognitionError(code), code).toBe("not_found");
    expect(mapRecognitionError("22023")).toBe("invalid");
    expect(mapRecognitionError("23514")).toBe("invalid");
    expect(mapRecognitionError("XX000")).toBeNull();
    expect(mapRecognitionError(undefined)).toBeNull();
  });
});
