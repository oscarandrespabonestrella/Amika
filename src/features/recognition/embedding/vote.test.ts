import { describe, expect, it } from "vitest";
import { createVoter } from "./vote";

type Row = { gameId: string; score: number; kind: "cover" | "learned" };
const frame = (top: string, score = 0.7, second?: [string, number]): Row[] => [
  { gameId: top, score, kind: "cover" },
  ...(second
    ? [{ gameId: second[0], score: second[1], kind: "cover" as const }]
    : []),
];

describe("createVoter", () => {
  it("locks on the third agreeing frame, not before", () => {
    const voter = createVoter();
    expect(voter.push(frame("a", 0.7, ["b", 0.5]))).toBeNull();
    expect(voter.push(frame("a", 0.7, ["b", 0.5]))).toBeNull();
    const lock = voter.push(frame("a", 0.7, ["b", 0.5]));
    expect(lock).toMatchObject({ gameId: "a", votes: 3 });
    expect(lock!.similarity).toBeCloseTo(0.7, 6);
    expect(lock!.margin).toBeCloseTo(0.2, 6);
  });

  it("needs 3 of the last 5 for the same game: A B A B A locks A only on the fifth", () => {
    const voter = createVoter();
    const seq = ["a", "b", "a", "b", "a"];
    const out = seq.map((g) => voter.push(frame(g, 0.7, ["z", 0.3])));
    expect(out.slice(0, 4)).toEqual([null, null, null, null]);
    expect(out[4]).toMatchObject({ gameId: "a", votes: 3 });
  });

  it("a frame below the minimum similarity never votes (but still takes a window slot)", () => {
    const voter = createVoter();
    for (let i = 0; i < 6; i++)
      expect(voter.push(frame("a", 0.3, ["b", 0.1]))).toBeNull();
    // weak frames occupied the window: it takes a fresh 3 good ones to lock
    expect(voter.push(frame("a", 0.7, ["b", 0.3]))).toBeNull();
    expect(voter.push(frame("a", 0.7, ["b", 0.3]))).toBeNull();
    expect(voter.push(frame("a", 0.7, ["b", 0.3]))).toMatchObject({
      gameId: "a",
    });
  });

  it("never locks when the first two are nearly tied (ambiguous)", () => {
    const voter = createVoter();
    for (let i = 0; i < 10; i++)
      expect(voter.push(frame("a", 0.7, ["b", 0.695]))).toBeNull();
  });

  it("a lone candidate with no runner-up counts as a full margin", () => {
    const voter = createVoter();
    voter.push(frame("a", 0.6));
    voter.push(frame("a", 0.6));
    expect(voter.push(frame("a", 0.6))).toMatchObject({ margin: 1 });
  });

  it("an empty ranking (no references) never votes or throws", () => {
    const voter = createVoter();
    for (let i = 0; i < 6; i++) expect(voter.push([])).toBeNull();
  });

  it("reset() forgets everything", () => {
    const voter = createVoter();
    voter.push(frame("a"));
    voter.push(frame("a"));
    voter.reset();
    expect(voter.push(frame("a"))).toBeNull();
    expect(voter.push(frame("a"))).toBeNull();
    expect(voter.push(frame("a"))).toMatchObject({ gameId: "a" });
  });

  it("the lock follows the majority: B taking over replaces A, and B's weak margin yields none", () => {
    const voter = createVoter();
    for (let i = 0; i < 3; i++) voter.push(frame("a", 0.7, ["x", 0.3]));
    voter.push(frame("b", 0.7, ["x", 0.3]));
    voter.push(frame("b", 0.7, ["x", 0.3]));
    expect(voter.push(frame("b", 0.7, ["x", 0.3]))).toMatchObject({
      gameId: "b",
    });

    // While A still holds 3 of the last 5 it keeps the lock; once B takes over with a
    // weak lead over the runner-up, nothing locks.
    const weak = createVoter();
    for (let i = 0; i < 3; i++) weak.push(frame("a", 0.7, ["x", 0.3]));
    expect(weak.push(frame("b", 0.7, ["x", 0.695]))).toMatchObject({
      gameId: "a",
    });
    expect(weak.push(frame("b", 0.7, ["x", 0.695]))).toMatchObject({
      gameId: "a",
    });
    expect(weak.push(frame("b", 0.7, ["x", 0.695]))).toBeNull();
  });

  it("an exact tie of votes between two games does not lock", () => {
    const voter = createVoter({ window: 6, minVotes: 3 });
    const seq = ["a", "a", "a", "b", "b", "b"];
    const out = seq.map((g) => voter.push(frame(g, 0.7, ["z", 0.3])));
    expect(out[5]).toBeNull();
  });

  it("honors custom options", () => {
    const voter = createVoter({ window: 3, minVotes: 2, minSimilarity: 0.9 });
    expect(voter.push(frame("a", 0.8, ["b", 0.1]))).toBeNull();
    expect(voter.push(frame("a", 0.95, ["b", 0.1]))).toBeNull();
    expect(voter.push(frame("a", 0.95, ["b", 0.1]))).toMatchObject({
      votes: 2,
    });
  });
});
