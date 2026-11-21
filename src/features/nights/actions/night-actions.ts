"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { ensureDisplayName } from "@/features/profiles";
import { logger } from "@/lib/logger";
import type { NightErrorCode } from "../error-codes";
import { idSchema, nightInputSchema } from "../schemas";
import {
  closeNight,
  createNight,
  createNightLink,
  inviteToNight,
  leaveNight,
  NightError,
  respondNightInvite,
  revokeNightLink,
  setNightGame,
  suggestNightGame,
  toggleNightVote,
} from "../services/night-service";

type Failure = { ok: false; error: NightErrorCode };

/** Common frame: signed in, run, revalidate; the database is the real gatekeeper. */
async function run<T extends object>(
  name: string,
  work: () => Promise<({ ok: true } & T) | Failure>,
): Promise<({ ok: true } & T) | Failure> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const result = await work();
    if (result.ok) revalidatePath("/nights", "layout");
    return result;
  } catch (error) {
    if (error instanceof NightError) return { ok: false, error: error.code };
    unstable_rethrow(error);
    logger.error(`nights.${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

const invalid: Failure = { ok: false, error: "invalid" };

export async function createNightAction(input: unknown) {
  return run<{ id: string }>("create", async () => {
    const parsed = nightInputSchema.safeParse(input);
    if (!parsed.success) return invalid;
    const result = await createNight(parsed.data);
    return "error" in result
      ? { ok: false, error: result.error }
      : { ok: true, id: result.id };
  });
}

export async function setNightGameAction(
  nightId: unknown,
  gameId: unknown,
  change: unknown,
) {
  return run<object>("setGame", async () => {
    const n = idSchema.safeParse(nightId);
    const g = idSchema.safeParse(gameId);
    if (!n.success || !g.success) return invalid;
    if (change === "remove") {
      await setNightGame(n.data, g.data, "remove");
      return { ok: true };
    }
    if (typeof change !== "object" || change === null) return invalid;
    const { pinned, played } = change as Record<string, unknown>;
    const patch: { pinned?: boolean; played?: boolean } = {};
    if (pinned !== undefined) {
      if (typeof pinned !== "boolean") return invalid;
      patch.pinned = pinned;
    }
    if (played !== undefined) {
      if (typeof played !== "boolean") return invalid;
      patch.played = played;
    }
    if (Object.keys(patch).length === 0) return invalid;
    await setNightGame(n.data, g.data, patch);
    return { ok: true };
  });
}

export async function closeNightAction(nightId: unknown) {
  return run<object>("close", async () => {
    const n = idSchema.safeParse(nightId);
    if (!n.success) return invalid;
    await closeNight(n.data);
    return { ok: true };
  });
}

export async function inviteToNightAction(nightId: unknown, friendId: unknown) {
  return run<object>("invite", async () => {
    const n = idSchema.safeParse(nightId);
    if (
      !n.success ||
      typeof friendId !== "string" ||
      friendId.length === 0 ||
      friendId.length > 200
    )
      return invalid;
    await inviteToNight(n.data, friendId);
    return { ok: true };
  });
}

export async function respondNightInviteAction(
  nightId: unknown,
  accept: unknown,
) {
  return run<object>("respond", async () => {
    const n = idSchema.safeParse(nightId);
    if (!n.success || typeof accept !== "boolean") return invalid;
    await respondNightInvite(n.data, accept);
    return { ok: true };
  });
}

export async function leaveNightAction(nightId: unknown) {
  return run<object>("leave", async () => {
    const n = idSchema.safeParse(nightId);
    if (!n.success) return invalid;
    await leaveNight(n.data);
    return { ok: true };
  });
}

export async function suggestNightGameAction(
  nightId: unknown,
  gameId: unknown,
) {
  return run<object>("suggest", async () => {
    const n = idSchema.safeParse(nightId);
    const g = idSchema.safeParse(gameId);
    if (!n.success || !g.success) return invalid;
    await suggestNightGame(n.data, g.data);
    return { ok: true };
  });
}

export async function toggleNightVoteAction(nightGameId: unknown) {
  return run<{ voted: boolean }>("vote", async () => {
    const g = idSchema.safeParse(nightGameId);
    if (!g.success) return invalid;
    return { ok: true, voted: await toggleNightVote(g.data) };
  });
}

/** The browser builds the public link from its own origin; the token is never stored here. */
export async function createNightLinkAction(nightId: unknown) {
  return run<{ token: string; expiresAt: string }>("createLink", async () => {
    const n = idSchema.safeParse(nightId);
    if (!n.success) return invalid;
    await ensureDisplayName(); // guests will see the host's name
    const { token, expiresAt } = await createNightLink(n.data);
    return { ok: true, token, expiresAt };
  });
}

export async function revokeNightLinkAction(nightId: unknown) {
  return run<object>("revokeLink", async () => {
    const n = idSchema.safeParse(nightId);
    if (!n.success) return invalid;
    await revokeNightLink(n.data);
    return { ok: true };
  });
}
