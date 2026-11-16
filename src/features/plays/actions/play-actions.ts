"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import { createPlaySchema, playIdSchema, updatePlaySchema } from "../schemas";
import { createPlay, deletePlay, updatePlay } from "../services/play-service";

export type PlayResult<T extends object = object> =
  | ({ ok: true } & T)
  | {
      ok: false;
      error: "unauthenticated" | "invalid" | "not_found" | "limit" | "failed";
    };

/** Common frame: signed in, run, revalidate; the database (RLS) is the real gatekeeper. */
async function run<T extends object>(
  name: string,
  work: () => Promise<PlayResult<T>>,
): Promise<PlayResult<T>> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const result = await work();
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    logger.error(`plays.${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

/** Totals, ranks and winners are computed here; the input has no place for them. */
export async function createPlayAction(
  input: unknown,
): Promise<PlayResult<{ playId: string }>> {
  return run<{ playId: string }>("create", async () => {
    const parsed = createPlaySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const outcome = await createPlay(parsed.data);
    if (typeof outcome === "string") return { ok: false, error: outcome };
    return { ok: true, playId: outcome.playId };
  });
}

export async function updatePlayAction(
  input: unknown,
): Promise<PlayResult<{ playId: string }>> {
  return run<{ playId: string }>("update", async () => {
    const parsed = updatePlaySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const outcome = await updatePlay(parsed.data);
    if (typeof outcome === "string") return { ok: false, error: outcome };
    return { ok: true, playId: outcome.playId };
  });
}

export async function deletePlayAction(playId: unknown): Promise<PlayResult> {
  return run<object>("delete", async () => {
    const parsed = playIdSchema.safeParse(playId);
    if (!parsed.success) return { ok: false, error: "invalid" };
    await deletePlay(parsed.data);
    return { ok: true };
  });
}
