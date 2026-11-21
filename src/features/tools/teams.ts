import { clamp, defaultRng, shuffle, type Rng } from "./random";

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 6;

/**
 * Shuffles the names and deals them like cards, so team sizes differ by at most one.
 * With fewer names than teams, only as many teams as names are returned.
 */
export function makeTeams(
  names: readonly string[],
  teamCount: number,
  rng: Rng = defaultRng,
): string[][] {
  if (names.length === 0) return [];
  const count = Math.min(
    clamp(Math.trunc(teamCount) || MIN_TEAMS, MIN_TEAMS, MAX_TEAMS),
    names.length,
  );
  const teams: string[][] = Array.from({ length: count }, () => []);
  shuffle(names, rng).forEach((name, i) => teams[i % count].push(name));
  return teams;
}
