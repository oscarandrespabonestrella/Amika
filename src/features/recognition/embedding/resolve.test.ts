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
