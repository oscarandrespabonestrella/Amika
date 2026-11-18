import { describe, expect, it, vi } from "vitest";
import { importCollectionBatch } from "./import-collection";

const ROWS = [
  { bggId: "1", status: "owned" as const, rating: 9 },
  { bggId: "2", status: "previously_owned" as const, rating: null },
  { bggId: "3", status: "owned" as const, rating: null },
];

describe("importCollectionBatch", () => {
  it("adds the games that made it to the catalog and reports the rest", async () => {
    const addItems = vi.fn(async () => ({ added: 1, existing: 1 }));
    const result = await importCollectionBatch(ROWS, {
      importGames: async () => ({
        ok: true,
        games: new Map([
          ["1", "g1"],
          ["2", "g2"],
        ]),
        failed: ["3"],
      }),
      addItems,
    });
    expect(addItems).toHaveBeenCalledWith([
      { gameId: "g1", status: "owned", rating: 9 },
      { gameId: "g2", status: "previously_owned", rating: null },
    ]);
    expect(result).toEqual({ ok: true, added: 1, existing: 1, failed: ["3"] });
  });

  it("passes through rate limiting and unavailability without touching the library", async () => {
    const addItems = vi.fn();
    for (const error of ["rate_limited", "unavailable"] as const) {
      expect(
        await importCollectionBatch(ROWS, {
          importGames: async () => ({ ok: false, error }),
          addItems,
        }),
      ).toEqual({ ok: false, error });
    }
    expect(addItems).not.toHaveBeenCalled();
  });

  it("collapses any other import error to failed", async () => {
    expect(
      await importCollectionBatch(ROWS, {
        importGames: async () => ({ ok: false, error: "not_found" }),
        addItems: vi.fn(),
      }),
    ).toEqual({ ok: false, error: "failed" });
  });
});
