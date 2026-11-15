import { z } from "zod";

/** Error messages are stable codes; the UI translates them. */
export const displayNameSchema = z.object({
  displayName: z.string().trim().max(60, { message: "tooLong" }),
});
export type DisplayNameInput = z.input<typeof displayNameSchema>;
