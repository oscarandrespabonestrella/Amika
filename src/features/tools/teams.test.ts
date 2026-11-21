import { describe, expect, it } from "vitest";
import { makeTeams } from "./teams";

const names = ["Ana", "Luis", "Marta", "Pedro", "Sofia"];

describe("makeTeams", () => {
  it("uses every name once and balances sizes", () => {
    const teams = makeTeams(names, 2, () => 0.3);
    expect(teams).toHaveLength(2);
    expect(teams.flat().sort()).toEqual([...names].sort());
    expect(Math.abs(teams[0].length - teams[1].length)).toBeLessThanOrEqual(1);
  });
  it("never makes empty teams", () => {
    expect(makeTeams(["Ana", "Luis"], 5)).toHaveLength(2);
  });
  it("returns nothing without names", () => {
    expect(makeTeams([], 2)).toEqual([]);
  });
  it("clamps the team count", () => {
    expect(makeTeams(names, 1)).toHaveLength(2);
    expect(makeTeams(names.concat(names), 99)).toHaveLength(6);
  });
});
