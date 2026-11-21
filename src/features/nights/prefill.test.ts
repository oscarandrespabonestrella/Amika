import { describe, expect, it } from "vitest";
import { prefillFromNight } from "./prefill";
import type { NightDetail } from "./services/night-service";

const night = (over: Partial<NightDetail>): NightDetail =>
  ({
    id: "n1",
    groupId: "g1",
    members: [],
    ...over,
  }) as NightDetail;

const roster = [
  { id: "p1", friendId: "u1" },
  { id: "p2", friendId: "u2" },
  { id: "p3", friendId: null },
];

describe("prefillFromNight", () => {
  it("accepted linked friend added", () => {
    const n = night({
      members: [{ userId: "u1", name: "Ana", status: "accepted" }],
    });
    expect(prefillFromNight(n, roster)).toEqual({
      groupId: "g1",
      playerIds: ["p1"],
    });
  });

  it("invited friend not added", () => {
    const n = night({
      members: [{ userId: "u2", name: "Bo", status: "invited" }],
    });
    expect(prefillFromNight(n, roster).playerIds).toEqual([]);
  });

  it("unlinked friend not added", () => {
    const n = night({
      members: [{ userId: "u9", name: "Cy", status: "accepted" }],
    });
    expect(prefillFromNight(n, roster).playerIds).toEqual([]);
  });

  it("no group returns null groupId", () => {
    expect(
      prefillFromNight(night({ groupId: null }), roster).groupId,
    ).toBeNull();
  });
});
