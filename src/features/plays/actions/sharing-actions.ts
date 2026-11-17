"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { ScoreValue } from "@/features/scoring/engine/evaluate";
import { logger } from "@/lib/logger";
import { playIdSchema } from "../schemas";
import {
  inviteToPlaySchema,
  linkPlayerSchema,
  myScoresSchema,
  respondSchema,
} from "../sharing-schemas";
import {
  closePlay,
  inviteToPlay,
  leavePlay,
  linkPlayerToFriend,
  respondPlayerLink,
  respondPlayInvite,
  saveMyScores,
  type ShareError,
  unlinkPlayer,
} from "../services/sharing-service";

export type ShareResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: "unauthenticated" | "failed" | ShareError };

/** Common frame: signed in, run, revalidate; RLS and the SQL functions are the gatekeepers. */
async function run<T extends object>(
  name: string,
  work: () => Promise<ShareResult<T>>,
): Promise<ShareResult<T>> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const result = await work();
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    logger.error(`plays.sharing.${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

const done = (r: { error: ShareError } | { data: unknown }): ShareResult =>
  "error" in r ? { ok: false, error: r.error } : { ok: true };

export async function inviteToPlayAction(input: unknown) {
  return run("invite", async () => {
    const p = inviteToPlaySchema.safeParse(input);
    if (!p.success) return { ok: false, error: "invalid" };
    return done(
      await inviteToPlay(p.data.playId, p.data.friendId, p.data.seat),
    );
  });
}

export async function respondPlayInviteAction(input: unknown) {
  return run("respondInvite", async () => {
    const p = respondSchema.safeParse(input);
    if (!p.success) return { ok: false, error: "invalid" };
    return done(await respondPlayInvite(p.data.id, p.data.accept));
  });
}

export async function leavePlayAction(playId: unknown) {
  return run("leave", async () => {
    const p = playIdSchema.safeParse(playId);
    if (!p.success) return { ok: false, error: "invalid" };
    return done(await leavePlay(p.data));
  });
}

export async function linkPlayerAction(input: unknown) {
  return run("link", async () => {
    const p = linkPlayerSchema.safeParse(input);
    if (!p.success) return { ok: false, error: "invalid" };
    return done(await linkPlayerToFriend(p.data.playerId, p.data.friendId));
  });
}

export async function respondPlayerLinkAction(input: unknown) {
  return run("respondLink", async () => {
    const p = respondSchema.safeParse(input);
    if (!p.success) return { ok: false, error: "invalid" };
    return done(await respondPlayerLink(p.data.id, p.data.accept));
  });
}

export async function unlinkPlayerAction(playerId: unknown) {
  return run("unlink", async () => {
    const p = playIdSchema.safeParse(playerId);
    if (!p.success) return { ok: false, error: "invalid" };
    return done(await unlinkPlayer(p.data));
  });
}

export async function saveMyScoresAction(input: unknown) {
  return run("saveMine", async () => {
    const p = myScoresSchema.safeParse(input);
    if (!p.success) return { ok: false, error: "invalid" };
    return done(
      await saveMyScores(
        p.data.playId,
        p.data.values as Record<string, ScoreValue>,
      ),
    );
  });
}

export async function closePlayAction(playId: unknown) {
  return run("close", async () => {
    const p = playIdSchema.safeParse(playId);
    if (!p.success) return { ok: false, error: "invalid" };
    return done(await closePlay(p.data));
  });
}
