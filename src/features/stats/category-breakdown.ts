// Pure: no React, no Supabase. Points per category come from the scoring engine (stored
// scores are raw inputs), so the average is of POINTS, never of the typed values.
import {
  evaluateValidated,
  type ScoreValue,
} from "@/features/scoring/engine/evaluate";
import { validateDefinition } from "@/features/scoring/engine/validate";

export type BreakdownPlay = {
  versionId: string;
  playedOn: string;
  participants: {
    playerId: string;
    name: string;
    /** Null = nothing recorded for this player in this match. */
    total: number | null;
    values: Record<string, ScoreValue | undefined>;
  }[];
};

export type CategoryBreakdown = {
  versionId: string;
  categories: { key: string; label: string }[];
  rows: {
    playerId: string;
    name: string;
    matches: number;
    averages: Record<string, number>;
  }[];
  /** Matches on the chosen version / matches on any other version (left out). */
  used: number;
  skipped: number;
};

/**
 * Average points per scoring category and player over the matches played with ONE sheet
 * version: the one most matches used (a tie goes to the most recently played). Matches on
 * other versions are counted in `skipped`, because their categories may differ. A
 * participant without a recorded total is ignored; within a scored participant a missing
 * value is 0 points (the engine's rule). Null when nothing can be shown.
 */
export function categoryAverages(
  plays: BreakdownPlay[],
  /** Stored (untrusted) definition of each version, validated here once. */
  definitions: ReadonlyMap<string, unknown>,
): CategoryBreakdown | null {
  if (plays.length === 0) return null;

  const stats = new Map<string, { count: number; latest: string }>();
  for (const p of plays) {
    const s = stats.get(p.versionId) ?? { count: 0, latest: "" };
    s.count += 1;
    if (p.playedOn > s.latest) s.latest = p.playedOn;
    stats.set(p.versionId, s);
  }
  const [chosen] = [...stats.entries()].sort(
    ([, a], [, b]) =>
      b.count - a.count ||
      (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0),
  );
  const versionId = chosen[0];

  const onVersion = plays.filter((p) => p.versionId === versionId);
  if (!definitions.has(versionId)) return null;
  const validated = validateDefinition(definitions.get(versionId));
  if (!validated.ok) return null;
  const definition = validated.definition;
  const categories = definition.categories
    .filter((c) => c.scoring)
    .map((c) => ({ key: c.key, label: c.label }));
  if (categories.length === 0) return null;

  type Acc = {
    name: string;
    matches: number;
    sums: Record<string, number>;
  };
  const acc = new Map<string, Acc>();
  for (const play of onVersion) {
    for (const person of play.participants) {
      if (person.total === null) continue;
      const evaluation = evaluateValidated(definition, person.values);
      const entry = acc.get(person.playerId) ?? {
        name: person.name,
        matches: 0,
        sums: {},
      };
      entry.matches += 1;
      entry.name = person.name;
      for (const result of evaluation.categories)
        entry.sums[result.key] = (entry.sums[result.key] ?? 0) + result.points;
      acc.set(person.playerId, entry);
    }
  }
  if (acc.size === 0) return null;

  const rows = [...acc.entries()]
    .map(([playerId, e]) => ({
      playerId,
      name: e.name,
      matches: e.matches,
      averages: Object.fromEntries(
        categories.map((c) => [c.key, (e.sums[c.key] ?? 0) / e.matches]),
      ),
    }))
    .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));

  return {
    versionId,
    categories,
    rows,
    used: onVersion.length,
    skipped: plays.length - onVersion.length,
  };
}
