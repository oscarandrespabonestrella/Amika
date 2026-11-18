import { z } from "zod";

// Every Server Action argument is `unknown` until it passes through one of these.

const text = (max: number) => z.string().trim().min(1).max(max);

export const searchInputSchema = z.object({ gameId: z.uuid() }).strict();

export const proposeInputSchema = z
  .object({
    gameId: z.uuid(),
    url: z.string().trim().min(1).max(500),
    /** Shown to the reviewer; the server re-derives host, publisher and "official". */
    title: text(200),
    locale: z
      .string()
      .regex(/^[a-z]{2}$/)
      .nullable(),
  })
  .strict();

export const reviewInputSchema = z
  .object({ id: z.uuid(), decision: z.enum(["publish", "reject"]) })
  .strict();

export const idSchema = z.uuid();
