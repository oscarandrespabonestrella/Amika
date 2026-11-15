import { z } from "zod";
import { TERM_TYPES } from "../types";

const int = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullable();

/**
 * Defense in depth: whatever a source returns is validated again right before
 * it reaches the database function (the parser already sanitizes, this guards
 * against future sources or parser regressions).
 */
export const externalGameSchema = z.object({
  source: z.literal("bgg"),
  externalId: z.string().regex(/^\d{1,9}$/),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  kind: z.enum(["base", "expansion"]),
  name: z.string().min(1).max(200),
  originalName: z.string().max(200).nullable(),
  description: z.string().max(20_000).nullable(),
  yearPublished: int(1000, 2100),
  minPlayers: int(1, 999),
  maxPlayers: int(1, 999),
  minPlaytime: int(1, 10_000),
  maxPlaytime: int(1, 10_000),
  minAge: int(0, 99),
  coverUrl: z
    .string()
    .max(500)
    .regex(/^https:\/\//)
    .nullable(),
  terms: z
    .array(
      z.object({
        type: z.enum(TERM_TYPES),
        externalId: z.string().regex(/^\d{1,9}$/),
        name: z.string().min(1).max(200),
      }),
    )
    .max(200),
  relations: z
    .array(
      z.object({
        type: z.enum(["expansion_of", "has_expansion"]),
        externalId: z.string().regex(/^\d{1,9}$/),
        name: z.string().min(1).max(200),
      }),
    )
    .max(200),
});
