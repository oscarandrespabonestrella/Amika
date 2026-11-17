import { z } from "zod";
import { KEY_PATTERN } from "@/features/scoring/engine/definition";

/** Inputs of the sharing actions. Errors are codes; the UI translates them. */
export const inviteToPlaySchema = z.strictObject({
  playId: z.uuid(),
  friendId: z.string().min(1).max(200),
  seat: z.number().int().min(0).max(11),
});

export const respondSchema = z.strictObject({
  id: z.uuid(),
  accept: z.boolean(),
});

export const linkPlayerSchema = z.strictObject({
  playerId: z.uuid(),
  friendId: z.string().min(1).max(200),
});

/** The values a member writes in their own column: engine keys only, checked again on save. */
export const myScoresSchema = z.strictObject({
  playId: z.uuid(),
  values: z.record(z.string().regex(KEY_PATTERN), z.unknown()),
});
