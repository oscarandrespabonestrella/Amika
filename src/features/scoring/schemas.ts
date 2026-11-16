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
  /** The version the author was editing: the save creates `baseVersion + 1` or conflicts. */
  baseVersion: z.number().int().min(1),
});

export const sheetRenameSchema = z.strictObject({
  sheetId: z.uuid(),
  title,
  locale,
});

/**
 * The title of a copy: the source title (cut by whole characters, so an emoji is
 * never split) plus the suffix, never longer than the title limit.
 */
export function composeCopyTitle(title: string, suffix: string): string {
  const base = title.trim();
  const tail = suffix.trim();
  if (base === "") return Array.from(tail).slice(0, SHEET_TITLE_MAX).join("");
  const room = Math.max(SHEET_TITLE_MAX - Array.from(tail).length - 1, 0);
  const head = Array.from(base).slice(0, room).join("").trimEnd();
  return `${head} ${tail}`;
}
