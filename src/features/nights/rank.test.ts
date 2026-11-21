import { describe, expect, it } from "vitest";
import { type Candidate, rankCandidates, spin } from "./rank";

const TODAY = "2026-11-21";

function game(
  over: Partial<Candidate> & { gameId: string; name: string },
): Candidate {
  return {
    coverUrl: null,
    isCustom: false,
    minPlayers: null,
    maxPlayers: null,
    minPlaytime: null,
    maxPlaytime: null,
    isFavorite: false,
    rating: null,
    playCount: 0,
    lastPlayedOn: null,
    ...over,
  };
}

describe("rankCandidates", () => {
  it("empty input returns empty", () => {
    expect(rankCandidates([], { today: TODAY })).toEqual([]);
  });

  it("never played beats played recently", () => {
    const [first] = rankCandidates(
      [
        game({
          gameId: "a",
          name: "Recent",
          lastPlayedOn: "2026-11-20",
          playCount: 3,
        }),
        game({ gameId: "b", name: "Nunca" }),
      ],
      { today: TODAY },
    );
    expect(first.gameId).toBe("b");
  });

  it("favorite adds 2", () => {
    const base = { lastPlayedOn: "2026-08-01", playCount: 1, rating: 7 };
    const [plain, fav] = rankCandidates(
      [
        game({ gameId: "p", name: "Plain", ...base }),
        game({ gameId: "f", name: "Fav", isFavorite: true, ...base }),
      ],
      { today: TODAY },
    );
    const plainScore = plain.gameId === "p" ? plain.score : fav.score;
    const favScore = fav.gameId === "f" ? fav.score : plain.score;
    expect(favScore - plainScore).toBeCloseTo(2);
  });

  it("recency saturates at 180 days", () => {
    const ranked = rankCandidates(
      [
        game({
          gameId: "a",
          name: "A",
          lastPlayedOn: "2026-05-05",
          playCount: 1,
        }), // 200 días
        game({
          gameId: "b",
          name: "B",
          lastPlayedOn: "2025-10-17",
          playCount: 1,
        }), // 400 días
      ],
      { today: TODAY },
    );
    expect(ranked[0].score).toBeCloseTo(3);
    expect(ranked[1].score).toBeCloseTo(3);
  });

  it("ties by name", () => {
    const ranked = rankCandidates(
      [
        game({ gameId: "z", name: "Zeta" }),
        game({ gameId: "a", name: "alfa" }),
      ],
      { today: TODAY },
    );
    expect(ranked.map((r) => r.name)).toEqual(["alfa", "Zeta"]);
  });

  it("reasons: notPlayedFor with whole months", () => {
    const [r] = rankCandidates(
      [
        game({
          gameId: "a",
          name: "A",
          lastPlayedOn: "2026-08-18",
          playCount: 1,
        }),
      ], // 95 días
      { today: TODAY },
    );
    expect(r.reasons).toContainEqual({ key: "notPlayedFor", months: 3 });
  });

  it("reasons: highlyRated at rating 8 or more", () => {
    const [r] = rankCandidates([game({ gameId: "a", name: "A", rating: 9 })], {
      today: TODAY,
    });
    expect(r.reasons).toContainEqual({ key: "highlyRated" });
  });

  it("reasons: neverPlayed, favorite and fitsPlayers", () => {
    const [r] = rankCandidates(
      [game({ gameId: "a", name: "A", isFavorite: true })],
      { today: TODAY, players: 4 },
    );
    expect(r.reasons).toEqual([
      { key: "neverPlayed" },
      { key: "favorite" },
      { key: "fitsPlayers", players: 4 },
    ]);
  });

  it("rating null contributes nothing and no highlyRated reason", () => {
    const [r] = rankCandidates(
      [game({ gameId: "a", name: "A", rating: null })],
      {
        today: TODAY,
      },
    );
    expect(r.reasons.some((x) => x.key === "highlyRated")).toBe(false);
    expect(r.score).toBeCloseTo(3);
  });

  it("does not filter by players", () => {
    const ranked = rankCandidates(
      [game({ gameId: "a", name: "A" }), game({ gameId: "b", name: "B" })],
      { today: TODAY, players: 2 },
    );
    expect(ranked).toHaveLength(2);
  });

  it("limit default 5", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      game({ gameId: `g${i}`, name: `G${i}` }),
    );
    expect(rankCandidates(many, { today: TODAY })).toHaveLength(5);
    expect(rankCandidates(many, { today: TODAY, limit: 2 })).toHaveLength(2);
  });
});

describe("spin", () => {
  it("spin([]) returns null", () => {
    expect(spin([], () => 0)).toBeNull();
  });

  it("with random = 0 returns the first item", () => {
    const items = [
      { id: "a", score: 5, votes: 0 },
      { id: "b", score: 3, votes: 0 },
    ];
    expect(spin(items, () => 0)).toBe("a");
  });

  it("weights the voted item by its votes", () => {
    const items = [
      { id: "a", score: 5, votes: 0 },
      { id: "b", score: 5, votes: 0 },
      { id: "c", score: 5, votes: 3 },
    ];
    // pesos 1, 1, 4 → total 6; 0.5 × 6 = 3 cae en "c"
    expect(spin(items, () => 0.5)).toBe("c");
  });

  it("falls back to 1 + votes when maxScore is 0", () => {
    const items = [
      { id: "a", score: 0, votes: 0 },
      { id: "b", score: 0, votes: 1 },
    ];
    // pesos 1, 2 → total 3; 0.5 × 3 = 1.5 cae en "b"
    expect(spin(items, () => 0.5)).toBe("b");
  });
});
