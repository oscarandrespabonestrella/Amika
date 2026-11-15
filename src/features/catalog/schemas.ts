import { z } from "zod";
import { routing } from "@/i18n/routing";

/**
 * Error messages are stable CODES, not sentences: the UI translates them
 * (Games.form.errors.*), so validation text is never hard-coded in English.
 */

// --- search ------------------------------------------------------------------

export type SearchParams = {
  q: string;
  kind?: "base" | "expansion";
  players?: number;
  time?: number;
};

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** Tolerant: an invalid filter is dropped instead of failing the whole page. */
export function parseSearchParams(
  raw: Record<string, string | string[] | undefined>,
): SearchParams {
  const q = z
    .string()
    .trim()
    .max(100)
    .safeParse(first(raw.q) ?? "");
  const kind = z.enum(["base", "expansion"]).safeParse(first(raw.kind));
  const players = z.coerce
    .number()
    .int()
    .min(1)
    .max(99)
    .safeParse(first(raw.players));
  const time = z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .safeParse(first(raw.time));
  return {
    q: q.success ? q.data : "",
    kind: kind.success ? kind.data : undefined,
    players:
      players.success && first(raw.players) !== "" ? players.data : undefined,
    time: time.success && first(raw.time) !== "" ? time.data : undefined,
  };
}

export const externalIdSchema = z.string().regex(/^\d{1,9}$/);
export const bggQuerySchema = z.string().trim().min(2).max(100);

// --- custom games ------------------------------------------------------------

/** Text -> integer, or undefined when blank. Only call it on text already validated. */
const toInt = (value: string | undefined): number | undefined =>
  value === undefined || value === "" ? undefined : Number(value);

/**
 * Validates the FORMAT only (digits within a range). Conversion to numbers happens
 * last, in the final transform: that way a bad field never hides the cross-field
 * min/max checks, and the user sees every problem at once.
 */
const intText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === "") return;
      if (
        !/^\d{1,6}$/.test(value) ||
        Number(value) < min ||
        Number(value) > max
      ) {
        ctx.addIssue({ code: "custom", message: "range" });
      }
    });

export const customGameSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: "required" })
      .max(200, { message: "tooLong" }),
    kind: z.enum(["base", "expansion"]),
    yearPublished: intText(1000, 2100),
    minPlayers: intText(1, 99),
    maxPlayers: intText(1, 99),
    minPlaytime: intText(1, 10_000),
    maxPlaytime: intText(1, 10_000),
    minAge: intText(0, 99),
    description: z.string().trim().max(5000, { message: "tooLong" }).optional(),
    locale: z.enum(routing.locales),
  })
  .superRefine((game, ctx) => {
    const order = (
      minText: string | undefined,
      maxText: string | undefined,
      field: string,
    ) => {
      const min = toInt(minText);
      const max = toInt(maxText);
      const valid = (v: string | undefined) =>
        v !== undefined && /^\d{1,6}$/.test(v);
      if (valid(minText) && valid(maxText) && min! > max!) {
        ctx.addIssue({ code: "custom", path: [field], message: "order" });
      }
    };
    order(game.minPlayers, game.maxPlayers, "maxPlayers");
    order(game.minPlaytime, game.maxPlaytime, "maxPlaytime");
  })
  .transform((game) => ({
    ...game,
    yearPublished: toInt(game.yearPublished),
    minPlayers: toInt(game.minPlayers),
    maxPlayers: toInt(game.maxPlayers),
    minPlaytime: toInt(game.minPlaytime),
    maxPlaytime: toInt(game.maxPlaytime),
    minAge: toInt(game.minAge),
  }));
/** What the form (and the Server Action) receives: everything is a string. */
export type CustomGameInput = z.input<typeof customGameSchema>;
export type CustomGameData = z.output<typeof customGameSchema>;
