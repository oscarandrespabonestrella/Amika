import { z } from "zod";
import { routing } from "@/i18n/routing";

export const THEMES = ["light", "dark", "system"] as const;

export const preferencesSchema = z
  .object({
    theme: z.enum(THEMES).optional(),
    locale: z.enum(routing.locales).optional(),
  })
  .strict()
  .refine((value) => value.theme !== undefined || value.locale !== undefined, {
    message: "At least one preference is required",
  });

export type PreferencesInput = z.infer<typeof preferencesSchema>;
