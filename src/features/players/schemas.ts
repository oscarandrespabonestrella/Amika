import { z } from "zod";

/** Error messages are stable CODES (required, tooLong, same): the UI translates them. */

export const PLAYER_NAME_MAX = 60;

export const playerNameSchema = z
  .string()
  .trim()
  .min(1, { message: "required" })
  .max(PLAYER_NAME_MAX, { message: "tooLong" });

export const playerIdSchema = z.uuid();

export const addPlayerSchema = z.strictObject({ name: playerNameSchema });

/** A friend added to the roster under a name (their display name, or a fallback). */
export const addFriendPlayerSchema = z.strictObject({
  friendId: z.string().min(1).max(200),
  name: playerNameSchema,
});

export const renamePlayerSchema = z.strictObject({
  playerId: z.uuid(),
  name: playerNameSchema,
});

export const mergePlayersSchema = z
  .strictObject({ keepId: z.uuid(), removeId: z.uuid() })
  .refine((m) => m.keepId !== m.removeId, {
    message: "same",
    path: ["removeId"],
  });

/** `null` clears the "this is me" mark. */
export const setMeSchema = z.strictObject({ playerId: z.uuid().nullable() });

export type RenamePlayerInput = z.infer<typeof renamePlayerSchema>;
export type MergePlayersInput = z.infer<typeof mergePlayersSchema>;
