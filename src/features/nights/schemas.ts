import { z } from "zod";

const uuid = z.string().uuid();

/** A real calendar date `YYYY-MM-DD` (rejects 2026-02-30). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  });

const players = z.number().int().min(1).max(100);
const maxMinutes = z.number().int().min(5).max(1440);

export const nightInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  startsOn: isoDate,
  players: players.optional(),
  maxMinutes: maxMinutes.optional(),
  groupId: uuid.optional(),
  gameIds: z
    .array(uuid)
    .min(1)
    .max(12)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type NightInput = z.infer<typeof nightInputSchema>;

export const pickerQuerySchema = z.object({
  players: players.optional(),
  maxMinutes: maxMinutes.optional(),
  groupId: uuid.optional(),
});
export type PickerQuery = z.infer<typeof pickerQuerySchema>;

export const guestNameSchema = z.string().trim().min(1).max(40);

export const idSchema = uuid;
export { isoDate as isoDateSchema };
