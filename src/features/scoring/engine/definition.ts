import { z } from "zod";

/**
 * Score sheet definition: a closed set of category types, integers only, no
 * executable content. Error messages are stable CODES; the UI translates them.
 */

export const SCORE_LIMITS = {
  maxCategories: 40,
  maxLabel: 60,
  maxTableRows: 50,
  maxOptions: 20,
  maxSetInputs: 8,
  maxRefs: 8,
  maxValue: 1_000_000,
  maxDefinitionBytes: 50_000,
} as const;

export const CATEGORY_TYPES = [
  "number",
  "count_times",
  "per_n",
  "boolean",
  "choice",
  "table",
  "set_bonus",
  "derived",
] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,29}$/;

const key = z.string().regex(KEY_PATTERN, { message: "invalidKey" });
const label = z
  .string()
  .trim()
  .min(1, { message: "required" })
  .max(SCORE_LIMITS.maxLabel, { message: "tooLong" });
const int = z
  .number()
  .int({ message: "invalidNumber" })
  .min(-SCORE_LIMITS.maxValue, { message: "outOfRange" })
  .max(SCORE_LIMITS.maxValue, { message: "outOfRange" });

const base = { key, label, scoring: z.boolean().default(true) };

const numberCategory = z.strictObject({
  ...base,
  type: z.literal("number"),
  min: int.optional(),
  max: int.optional(),
});

const countTimesCategory = z.strictObject({
  ...base,
  type: z.literal("count_times"),
  pointsEach: int,
  max: int.optional(),
});

const perNCategory = z.strictObject({
  ...base,
  type: z.literal("per_n"),
  n: int.min(1),
  pointsPer: int,
  max: int.optional(),
});

const booleanCategory = z.strictObject({
  ...base,
  type: z.literal("boolean"),
  points: int,
});

const choiceCategory = z.strictObject({
  ...base,
  type: z.literal("choice"),
  options: z
    .array(z.strictObject({ key, label, points: int }))
    .min(1)
    .max(SCORE_LIMITS.maxOptions),
});

const tableCategory = z.strictObject({
  ...base,
  type: z.literal("table"),
  rows: z
    .array(z.strictObject({ value: int, points: int }))
    .min(1)
    .max(SCORE_LIMITS.maxTableRows),
});

const setBonusCategory = z.strictObject({
  ...base,
  type: z.literal("set_bonus"),
  inputs: z
    .array(z.strictObject({ key, label }))
    .min(2)
    .max(SCORE_LIMITS.maxSetInputs),
  perSet: int,
});

export const DERIVED_OPS = [
  "sum",
  "product",
  "floor_div",
  "min",
  "max",
] as const;

const derivedCategory = z
  .strictObject({
    ...base,
    type: z.literal("derived"),
    op: z.enum(DERIVED_OPS),
    refs: z.array(key).min(2).max(SCORE_LIMITS.maxRefs),
  })
  .refine((c) => c.op !== "floor_div" || c.refs.length === 2, {
    message: "floorDivNeedsTwoRefs",
    path: ["refs"],
  });

export const categorySchema = z.discriminatedUnion("type", [
  numberCategory,
  countTimesCategory,
  perNCategory,
  booleanCategory,
  choiceCategory,
  tableCategory,
  setBonusCategory,
  derivedCategory,
]);

export const definitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  categories: z.array(categorySchema).min(1).max(SCORE_LIMITS.maxCategories),
});

export type Category = z.infer<typeof categorySchema>;
export type Definition = z.infer<typeof definitionSchema>;
