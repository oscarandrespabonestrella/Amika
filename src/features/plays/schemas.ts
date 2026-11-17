import { z } from "zod";
import { normalizePlayerName } from "@/features/players/normalize";
import {
  KEY_PATTERN,
  SCORE_LIMITS,
} from "@/features/scoring/engine/definition";

/**
 * Error messages are stable CODES (required, tooLong, invalidDate, outOfRange,
 * duplicate): the UI translates them. Totals, ranks and winners are NOT part of the
 * input (strict objects): the server computes them.
 */

export const PLAY_LIMITS = {
  maxParticipants: 12,
  maxName: 60,
  maxNotes: 2000,
  maxExpansions: 20,
  maxDuration: 1440,
  maxManualTotal: SCORE_LIMITS.maxValue,
} as const;

export const playIdSchema = z.uuid();

const participantSchema = z.strictObject({
  /** A roster player; null = a new or typed name (the database creates or reuses it). */
  playerId: z.uuid().nullable().default(null),
  name: z
    .string()
    .trim()
    .min(1, { message: "required" })
    .max(PLAY_LIMITS.maxName, { message: "tooLong" }),
  values: z.record(z.string().regex(KEY_PATTERN), z.unknown()).optional(),
  manualTotal: z
    .number()
    .int({ message: "outOfRange" })
    .min(-PLAY_LIMITS.maxManualTotal, { message: "outOfRange" })
    .max(PLAY_LIMITS.maxManualTotal, { message: "outOfRange" })
    .nullable()
    .optional(),
});

const shared = {
  playedOn: z.iso.date({ message: "invalidDate" }),
  durationMinutes: z
    .number()
    .int({ message: "outOfRange" })
    .min(1, { message: "outOfRange" })
    .max(PLAY_LIMITS.maxDuration, { message: "outOfRange" })
    .nullable()
    .default(null),
  notes: z
    .string()
    .trim()
    .max(PLAY_LIMITS.maxNotes, { message: "tooLong" })
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
  expansionIds: z
    .array(z.uuid())
    .max(PLAY_LIMITS.maxExpansions, { message: "tooMany" })
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "duplicate",
    }),
  participants: z
    .array(participantSchema)
    .min(1, { message: "required" })
    .max(PLAY_LIMITS.maxParticipants, { message: "tooMany" })
    // One player, once per match: same roster entry, or names that normalize alike.
    .refine(
      (people) => {
        const ids = people
          .map((p) => p.playerId)
          .filter((id): id is string => id !== null);
        const names = people.map((p) => normalizePlayerName(p.name));
        return (
          new Set(ids).size === ids.length &&
          new Set(names).size === names.length
        );
      },
      { message: "duplicatePlayer" },
    ),
};

export const createPlaySchema = z.strictObject({
  gameId: z.uuid(),
  sheetId: z.uuid().nullable().default(null),
  /** 'open' starts a live match that friends can join; the default keeps today's behavior. */
  status: z.enum(["open", "closed"]).default("closed"),
  ...shared,
});

/** The game and the sheet of a match never change after it is created. */
export const updatePlaySchema = z.strictObject({
  playId: z.uuid(),
  ...shared,
});

export type CreatePlayInput = z.infer<typeof createPlaySchema>;
export type UpdatePlayInput = z.infer<typeof updatePlaySchema>;
