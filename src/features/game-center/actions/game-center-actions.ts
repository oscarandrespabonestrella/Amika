"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  faqInputSchema,
  faqReviewSchema,
  idSchema,
  imageInputSchema,
  resourceInputSchema,
  rulesSummarySchema,
} from "../schemas";
import { isAdmin } from "../services/game-center-service";

export type GameCenterResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "invalid" | "limit" | "failed";
      fieldErrors?: Record<string, string>;
    };

type Issue = { path: PropertyKey[]; message: string };
const fieldErrorsOf = (issues: Issue[]) => {
  const out: Record<string, string> = {};
  for (const issue of issues)
    out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
};
const invalid = (issues: Issue[]): GameCenterResult => ({
  ok: false,
  error: "invalid",
  fieldErrors: fieldErrorsOf(issues),
});

/** Postgres codes we expect: 42501 = RLS said no, P0001 = a limit trigger fired. */
const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

/**
 * Common frame: signed in, (optionally) admin, run, revalidate. The database
 * (RLS) is the real gatekeeper; the admin check here just gives a clean error.
 */
async function run(
  options: { admin: boolean },
  work: (
    supabase: ReturnType<typeof createSupabaseServerClient>,
    userId: string,
    admin: boolean,
  ) => Promise<GameCenterResult>,
): Promise<GameCenterResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const admin = await isAdmin();
    if (options.admin && !admin) return { ok: false, error: "forbidden" };

    const result = await work(createSupabaseServerClient(), userId, admin);
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    if (pgCode(error) === "42501") return { ok: false, error: "forbidden" };
    if (pgCode(error) === "P0001") return { ok: false, error: "limit" };
    logger.error("game-center action failed", error);
    return { ok: false, error: "failed" };
  }
}

// --- administrator content ------------------------------------------------------

export async function addResourceAction(
  input: unknown,
): Promise<GameCenterResult> {
  return run({ admin: true }, async (supabase) => {
    const parsed = resourceInputSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const r = parsed.data;
    const { error } = await supabase.from("game_resources").insert({
      game_id: r.gameId,
      kind: r.kind,
      locale: r.locale,
      title: r.title,
      url: r.url,
      youtube_id: r.youtubeId,
      is_official: r.isOfficial,
    });
    if (error) throw error;
    return { ok: true };
  });
}

export async function deleteResourceAction(
  id: unknown,
): Promise<GameCenterResult> {
  return run({ admin: true }, async (supabase) => {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("game_resources")
      .delete()
      .eq("id", parsed.data);
    if (error) throw error;
    return { ok: true };
  });
}

export async function saveRulesSummaryAction(
  input: unknown,
): Promise<GameCenterResult> {
  return run({ admin: true }, async (supabase) => {
    const parsed = rulesSummarySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const { error } = await supabase.from("rules_content").upsert(
      {
        game_id: parsed.data.gameId,
        locale: parsed.data.locale,
        body: parsed.data.body,
      },
      { onConflict: "game_id,locale" },
    );
    if (error) throw error;
    return { ok: true };
  });
}

export async function deleteRulesSummaryAction(
  gameId: unknown,
  locale: unknown,
): Promise<GameCenterResult> {
  return run({ admin: true }, async (supabase) => {
    const game = idSchema.safeParse(gameId);
    if (!game.success || typeof locale !== "string")
      return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("rules_content")
      .delete()
      .eq("game_id", game.data)
      .eq("locale", locale);
    if (error) throw error;
    return { ok: true };
  });
}

export async function addImageAction(
  input: unknown,
): Promise<GameCenterResult> {
  return run({ admin: true }, async (supabase) => {
    const parsed = imageInputSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const i = parsed.data;
    const { error } = await supabase.from("game_images").insert({
      game_id: i.gameId,
      url: i.url,
      attribution: i.attribution,
      license: i.license || null,
      caption: i.caption || null,
    });
    if (error) throw error;
    return { ok: true };
  });
}

export async function deleteImageAction(
  id: unknown,
): Promise<GameCenterResult> {
  return run({ admin: true }, async (supabase) => {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("game_images")
      .delete()
      .eq("id", parsed.data);
    if (error) throw error;
    return { ok: true };
  });
}

// --- FAQ: anyone suggests, an administrator publishes ---------------------------

/** Admins publish directly; everyone else creates a private, pending suggestion. */
export async function createFaqAction(
  input: unknown,
): Promise<GameCenterResult> {
  return run({ admin: false }, async (supabase, _userId, admin) => {
    const parsed = faqInputSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const f = parsed.data;

    const { data: entry, error } = await supabase
      .from("faq_entries")
      .insert({ game_id: f.gameId, status: admin ? "published" : "pending" })
      .select("id")
      .single();
    if (error) throw error;

    const { error: translationError } = await supabase
      .from("faq_translations")
      .insert({
        faq_id: entry.id,
        locale: f.locale,
        question: f.question,
        answer: f.answer,
      });
    if (translationError) {
      await supabase.from("faq_entries").delete().eq("id", entry.id); // no empty entries
      throw translationError;
    }
    return { ok: true };
  });
}

export async function reviewFaqAction(
  input: unknown,
): Promise<GameCenterResult> {
  return run({ admin: true }, async (supabase, userId) => {
    const parsed = faqReviewSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("faq_entries")
      .update({
        status: parsed.data.decision === "approve" ? "published" : "rejected",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.faqId);
    if (error) throw error;
    return { ok: true };
  });
}

/** Admin: any entry. Author: only their own while pending (RLS enforces both). */
export async function deleteFaqAction(id: unknown): Promise<GameCenterResult> {
  return run({ admin: false }, async (supabase) => {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("faq_entries")
      .delete()
      .eq("id", parsed.data);
    if (error) throw error;
    return { ok: true };
  });
}
