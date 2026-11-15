import { z } from "zod";

/**
 * Fails fast, with a useful message, when the Supabase service key is unusable.
 *
 * Real case: the Supabase CLI/dashboard MASK new-style secret keys after creation
 * (`sb_secret_AbCdE********`). Pasting that mask gives "Invalid API key" at
 * runtime, far from the cause. Accepted: a legacy JWT service_role key, or a
 * full `sb_secret_…` key copied when it was created.
 */
export const serviceRoleKeySchema = z
  .string()
  .min(1, "SUPABASE_SERVICE_ROLE_KEY is missing")
  .refine((key) => /^[A-Za-z0-9._-]+$/.test(key), {
    message:
      "SUPABASE_SERVICE_ROLE_KEY contains characters a key never has (a masked key?). " +
      "Copy the full key from the dashboard (API Keys).",
  })
  .refine(
    (key) =>
      key.split(".").length === 3 || // legacy JWT
      (key.startsWith("sb_secret_") && key.length >= 40),
    {
      message:
        "SUPABASE_SERVICE_ROLE_KEY is not a service_role JWT nor a full sb_secret_ key.",
    },
  );
