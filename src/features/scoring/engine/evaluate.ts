import { type Category, type Definition, SCORE_LIMITS } from "./definition";
import { validateDefinition } from "./validate";

/**
 * number → number / count / table / per_n; boolean; string = choice option key;
 * record = set_bonus counters.
 */
export type ScoreValue = number | boolean | string | Record<string, number>;

export type FieldErrorCode =
  | "invalid"
  | "outOfRange"
  | "notInTable"
  | "unknownOption"
  | "divisionByZero"
  | "dependency";

export type CategoryResult = {
  key: string;
  points: number;
  error?: FieldErrorCode;
};

export type Evaluation = {
  ok: boolean;
  total: number;
  categories: CategoryResult[];
  invalidDefinition?: true;
};

/** Keeps every sum of up to 40 categories a safe integer. */
const MAX_POINTS = 1_000_000_000_000;

type Outcome = { points: number } | { error: FieldErrorCode };

const fail = (error: FieldErrorCode): Outcome => ({ error });
const withinPoints = (points: number): Outcome =>
  Number.isSafeInteger(points) && Math.abs(points) <= MAX_POINTS
    ? { points }
    : fail("outOfRange");

/** An integer within [min, max]; anything else is a field error. */
function integerIn(
  value: unknown,
  min: number,
  max: number,
): number | FieldErrorCode {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    return "invalid";
  return value < min || value > max ? "outOfRange" : value;
}

const isMissing = (value: unknown) => value === undefined || value === null;

function evaluateLeaf(
  category: Exclude<Category, { type: "derived" }>,
  value: unknown,
): Outcome {
  if (isMissing(value)) return { points: 0 };
  const limit = SCORE_LIMITS.maxValue;

  switch (category.type) {
    case "number": {
      const v = integerIn(
        value,
        Math.max(category.min ?? -limit, -limit),
        Math.min(category.max ?? limit, limit),
      );
      return typeof v === "number" ? { points: v } : fail(v);
    }
    case "count_times": {
      const v = integerIn(value, 0, Math.min(category.max ?? limit, limit));
      return typeof v === "number"
        ? withinPoints(v * category.pointsEach)
        : fail(v);
    }
    case "per_n": {
      const v = integerIn(value, 0, Math.min(category.max ?? limit, limit));
      return typeof v === "number"
        ? withinPoints(Math.floor(v / category.n) * category.pointsPer)
        : fail(v);
    }
    case "boolean":
      return typeof value === "boolean"
        ? { points: value ? category.points : 0 }
        : fail("invalid");
    case "choice": {
      if (typeof value !== "string") return fail("invalid");
      const option = category.options.find((o) => o.key === value);
      return option ? { points: option.points } : fail("unknownOption");
    }
    case "table": {
      const v = integerIn(value, -limit, limit);
      if (typeof v !== "number") return fail(v);
      const row = category.rows.find((r) => r.value === v);
      return row ? { points: row.points } : fail("notInTable");
    }
    case "set_bonus": {
      if (typeof value !== "object" || Array.isArray(value))
        return fail("invalid");
      const record = value as Record<string, unknown>;
      const known = new Set(category.inputs.map((i) => i.key));
      if (Object.keys(record).some((k) => !known.has(k)))
        return fail("invalid");
      const counts: number[] = [];
      for (const input of category.inputs) {
        const raw = Object.hasOwn(record, input.key) ? record[input.key] : 0;
        const v = isMissing(raw) ? 0 : integerIn(raw, 0, limit);
        if (typeof v !== "number") return fail(v);
        counts.push(v);
      }
      const squares = counts.reduce((sum, c) => sum + c * c, 0);
      return withinPoints(squares + category.perSet * Math.min(...counts));
    }
  }
}

function evaluateDerived(
  category: Extract<Category, { type: "derived" }>,
  results: ReadonlyMap<string, Outcome>,
): Outcome {
  const inputs: number[] = [];
  for (const ref of category.refs) {
    const outcome = results.get(ref);
    if (!outcome || "error" in outcome) return fail("dependency");
    inputs.push(outcome.points);
  }
  switch (category.op) {
    case "sum":
      return withinPoints(inputs.reduce((a, b) => a + b, 0));
    case "product":
      return withinPoints(inputs.reduce((a, b) => a * b, 1));
    case "min":
      return { points: Math.min(...inputs) };
    case "max":
      return { points: Math.max(...inputs) };
    case "floor_div": {
      const [a, b] = inputs;
      return b === 0 ? fail("divisionByZero") : withinPoints(Math.floor(a / b));
    }
  }
}

/** Leaves first (any order), then derived categories in dependency order. */
function evaluateAll(
  definition: Definition,
  values: Record<string, unknown>,
): Map<string, Outcome> {
  const results = new Map<string, Outcome>();
  const pending = new Map<string, Extract<Category, { type: "derived" }>>();

  for (const category of definition.categories) {
    if (category.type === "derived") {
      pending.set(category.key, category);
      continue;
    }
    const value = Object.hasOwn(values, category.key)
      ? values[category.key]
      : undefined;
    results.set(category.key, evaluateLeaf(category, value));
  }

  // validateDefinition guarantees no cycles, so every pass resolves at least one.
  while (pending.size > 0) {
    let progressed = false;
    for (const [key, category] of pending) {
      if (category.refs.some((ref) => pending.has(ref))) continue;
      results.set(key, evaluateDerived(category, results));
      pending.delete(key);
      progressed = true;
    }
    if (!progressed) break;
  }
  return results;
}

const INVALID: Evaluation = {
  ok: false,
  total: 0,
  categories: [],
  invalidDefinition: true,
};

/**
 * Pure and total: it revalidates the definition (stored definitions are
 * untrusted) and never throws, whatever it is given. A missing value is 0 points.
 */
export function evaluate(
  definition: unknown,
  values: Record<string, ScoreValue | undefined>,
): Evaluation {
  const validated = validateDefinition(definition);
  if (!validated.ok) return { ...INVALID, categories: [] };
  return evaluateValidated(validated.definition, values);
}

/**
 * Like `evaluate`, for a definition the caller already validated (e.g. once for many
 * participants). Still total: bad values never throw.
 */
export function evaluateValidated(
  definition: Definition,
  values: Record<string, ScoreValue | undefined>,
): Evaluation {
  const safeValues: Record<string, unknown> =
    values && typeof values === "object" && !Array.isArray(values)
      ? values
      : {};
  const results = evaluateAll(definition, safeValues);

  let total = 0;
  let ok = true;
  const categories = definition.categories.map((category) => {
    const outcome = results.get(category.key) ?? fail("dependency");
    if ("error" in outcome) {
      ok = false;
      return { key: category.key, points: 0, error: outcome.error };
    }
    if (category.scoring) total += outcome.points;
    return { key: category.key, points: outcome.points };
  });
  return { ok, total, categories };
}
