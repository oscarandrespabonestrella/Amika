import { z } from "zod";

/** Error messages are stable CODES (required, tooLong): the UI translates them. */

export const GROUP_NAME_MAX = 60;
/** A group cannot hold more players than the roster cap. */
export const GROUP_MEMBERS_MAX = 200;

export const groupNameSchema = z
  .string()
  .trim()
  .min(1, { message: "required" })
  .max(GROUP_NAME_MAX, { message: "tooLong" });

export const groupIdSchema = z.uuid();

export const createGroupSchema = z.strictObject({ name: groupNameSchema });

export const renameGroupSchema = z.strictObject({
  groupId: z.uuid(),
  name: groupNameSchema,
});

export const setMembersSchema = z.strictObject({
  groupId: z.uuid(),
  playerIds: z
    .array(z.uuid())
    .max(GROUP_MEMBERS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: "repeated" }),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type RenameGroupInput = z.infer<typeof renameGroupSchema>;
export type SetMembersInput = z.infer<typeof setMembersSchema>;
