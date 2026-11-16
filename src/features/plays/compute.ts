// Pure: no React, no Supabase. The browser uses it for live totals; the server uses
// it as the authority before saving. It imports the scoring engine files directly
// (not the module index, which pulls in server-only code).
import type { Definition } from "@/features/scoring/engine/definition";
import { SCORE_LIMITS } from "@/features/scoring/engine/definition";
import {
  evaluate,
  type FieldErrorCode,
  type ScoreValue,
} from "@/features/scoring/engine/evaluate";
import { validateDefinition } from "@/features/scoring/engine/validate";

export type ParticipantInput = {
  name: string;
  values?: Record<string, ScoreValue | undefined>;
  manualTotal?: number | null;
};

export type ParticipantResult = {
  name: string;
  seat: number;
  /** Null when nothing was recorded for this player (or the manual total is invalid). */
  total: number | null;
  rank: number | null;
  isWinner: boolean;
  /** Only the values that belong to the sheet; this is what gets stored. */
  scores: Record<string, ScoreValue>;
  errors: Record<string, FieldErrorCode>;
};

export type PlayComputation = {
  ok: boolean;
  participants: ParticipantResult[];
  invalidDefinition?: true;
};

/**
 * Competition ranking over non-null totals (highest first): 10, 8, 10, 5 → 1, 3, 1, 4.
 * Rank 1 is a winner, so ties all win. A null total is unranked and never wins.
 */
export function rankTotals(
  totals: readonly (number | null)[],
): { rank: number | null; isWinner: boolean }[] {
  return totals.map((total) => {
    if (total === null) return { rank: null, isWinner: false };
    const rank =
      1 + totals.filter((other) => other !== null && other > total).length;
    return { rank, isWinner: rank === 1 };
  });
}

type Partial = Pick<ParticipantResult, "total" | "scores" | "errors">;

function scoreWithSheet(
  definition: Definition,
  input: ParticipantInput,
): Partial {
  const known = new Set(
    definition.categories.filter((c) => c.type !== "derived").map((c) => c.key),
  );
  const scores: Record<string, ScoreValue> = {};
  for (const [key, value] of Object.entries(input.values ?? {})) {
    if (known.has(key) && value !== undefined && value !== null)
      scores[key] = value;
  }
  if (Object.keys(scores).length === 0)
    return { total: null, scores, errors: {} };

  const evaluation = evaluate(definition, scores);
  const errors: Record<string, FieldErrorCode> = {};
  for (const category of evaluation.categories)
    if (category.error) errors[category.key] = category.error;
  return { total: evaluation.total, scores, errors };
}

function scoreManually(input: ParticipantInput): Partial {
  const manual = input.manualTotal;
  if (manual === undefined || manual === null)
    return { total: null, scores: {}, errors: {} };
  if (!Number.isSafeInteger(manual))
    return { total: null, scores: {}, errors: { manual: "invalid" } };
  if (Math.abs(manual) > SCORE_LIMITS.maxValue)
    return { total: null, scores: {}, errors: { manual: "outOfRange" } };
  return { total: manual, scores: {}, errors: {} };
}

/**
 * Totals, ranks and winners for a match. `definition === null` means manual totals.
 * Values for categories that are not on the sheet are dropped; a player with nothing
 * recorded has no total and is not ranked; if nobody has a total nobody wins.
 */
export function computePlay(
  definition: unknown | null,
  participants: readonly ParticipantInput[],
): PlayComputation {
  let sheet: Definition | null = null;
  if (definition !== null) {
    const validated = validateDefinition(definition);
    if (!validated.ok)
      return { ok: false, participants: [], invalidDefinition: true };
    sheet = validated.definition;
  }

  const partials = participants.map((input) =>
    sheet ? scoreWithSheet(sheet, input) : scoreManually(input),
  );
  const ranks = rankTotals(partials.map((p) => p.total));

  const results = participants.map((input, seat): ParticipantResult => ({
    name: input.name,
    seat,
    ...partials[seat],
    ...ranks[seat],
  }));
  return {
    ok: results.every((p) => Object.keys(p.errors).length === 0),
    participants: results,
  };
}
