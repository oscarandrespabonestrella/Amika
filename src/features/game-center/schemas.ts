import { z } from "zod";
import { routing } from "@/i18n/routing";
import { parseYoutubeId } from "./youtube";

/**
 * Error messages are stable CODES (required, tooLong, invalidUrl, invalidVideo):
 * the UI translates them, so validation text is never hard-coded in English.
 */

export const RESOURCE_KINDS = ["rules", "video", "link"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** `any` = not tied to a language (stored as NULL). */
export const CONTENT_LOCALES = [...routing.locales, "any"] as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, { message: "required" })
    .max(max, { message: "tooLong" });

/** A public https URL only (no http, javascript:, data:, credentials in the URL...). */
const httpsUrl = z
  .string()
  .trim()
  .max(500, { message: "tooLong" })
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    },
    { message: "invalidUrl" },
  );

// --- admin content --------------------------------------------------------------

export const resourceInputSchema = z
  .object({
    gameId: z.uuid(),
    kind: z.enum(RESOURCE_KINDS),
    locale: z.enum(CONTENT_LOCALES),
    title: text(200),
    /** A URL for rules/links; a YouTube URL or id for videos. */
    target: z
      .string()
      .trim()
      .min(1, { message: "required" })
      .max(500, { message: "tooLong" }),
    isOfficial: z.boolean().default(false),
  })
  .strict()
  .transform((input, ctx) => {
    const locale = input.locale === "any" ? null : input.locale;
    if (input.kind === "video") {
      const youtubeId = parseYoutubeId(input.target);
      if (!youtubeId) {
        ctx.addIssue({
          code: "custom",
          path: ["target"],
          message: "invalidVideo",
        });
        return z.NEVER;
      }
      return {
        gameId: input.gameId,
        kind: input.kind,
        locale,
        title: input.title,
        url: null,
        youtubeId,
        isOfficial: input.isOfficial,
      };
    }
    const url = httpsUrl.safeParse(input.target);
    if (!url.success) {
      ctx.addIssue({ code: "custom", path: ["target"], message: "invalidUrl" });
      return z.NEVER;
    }
    return {
      gameId: input.gameId,
      kind: input.kind,
      locale,
      title: input.title,
      url: url.data,
      youtubeId: null,
      isOfficial: input.isOfficial,
    };
  });
export type ResourceInput = z.input<typeof resourceInputSchema>;

export const rulesSummarySchema = z
  .object({
    gameId: z.uuid(),
    locale: z.enum(routing.locales),
    body: z
      .string()
      .trim()
      .min(1, { message: "required" })
      .max(20_000, { message: "tooLong" }),
  })
  .strict();

export const imageInputSchema = z
  .object({
    gameId: z.uuid(),
    url: httpsUrl,
    attribution: text(200),
    license: z.string().trim().max(100, { message: "tooLong" }).optional(),
    caption: z.string().trim().max(200, { message: "tooLong" }).optional(),
  })
  .strict();

// --- FAQ ------------------------------------------------------------------------

export const faqInputSchema = z
  .object({
    gameId: z.uuid(),
    locale: z.enum(routing.locales),
    question: text(300),
    answer: text(3000),
  })
  .strict();
export type FaqInput = z.input<typeof faqInputSchema>;

export const faqReviewSchema = z
  .object({ faqId: z.uuid(), decision: z.enum(["approve", "reject"]) })
  .strict();

export const idSchema = z.uuid();
