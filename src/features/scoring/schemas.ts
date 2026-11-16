import { z } from "zod";
import { routing } from "@/i18n/routing";

/**
 * The definition travels as `unknown` and is validated with `validateDefinition`
 * (it reports every issue as a code); these schemas only cover the envelope.
 */

export const SHEET_TITLE_MAX = 80;

const title = z
  .string()
  .trim()
  .min(1, { message: "required" })
  .max(SHEET_TITLE_MAX, { message: "tooLong" });
const locale = z.enum(routing.locales);

export const sheetIdSchema = z.uuid();

export const sheetCreateSchema = z.strictObject({
  gameId: z.uuid(),
  title,
  locale,
  definition: z.unknown(),
});

export const sheetVersionSchema = z.strictObject({
  sheetId: z.uuid(),
  definition: z.unknown(),
});

export const sheetRenameSchema = z.strictObject({
  sheetId: z.uuid(),
  title,
  locale,
});
