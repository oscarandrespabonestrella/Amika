"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import { friendCodeSchema, userIdSchema } from "../schemas";
import {
  createFriendInvite,
  type FriendError,
  redeemFriendInvite,
  removeFriend,
  revokeFriendInvite,
} from "../services/friends-service";

type Failure = {
  ok: false;
  error: "unauthenticated" | "invalid" | "failed" | FriendError;
};

/** Common frame: signed in, run, revalidate; the database is the real gatekeeper. */
async function run<T extends object>(
  name: string,
  work: () => Promise<({ ok: true } & T) | Failure>,
): Promise<({ ok: true } & T) | Failure> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const result = await work();
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    logger.error(`friends.${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

/** The browser builds the link `/friends/join/<code>` from its own origin. */
export async function createFriendInviteAction() {
  return run<{ code: string }>("createInvite", async () => {
    const result = await createFriendInvite();
    return "error" in result
      ? { ok: false, error: result.error }
      : { ok: true, code: result.code };
  });
}

export async function revokeFriendInviteAction(code: unknown) {
  return run<object>("revokeInvite", async () => {
    const parsed = friendCodeSchema.safeParse(code);
    if (!parsed.success) return { ok: false, error: "invalid" };
    await revokeFriendInvite(parsed.data);
    return { ok: true };
  });
}

export async function redeemFriendInviteAction(code: unknown) {
  return run<{ friendId: string }>("redeemInvite", async () => {
    const parsed = friendCodeSchema.safeParse(code);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const result = await redeemFriendInvite(parsed.data);
    return "error" in result
      ? { ok: false, error: result.error }
      : { ok: true, friendId: result.friendId };
  });
}

export async function removeFriendAction(friendId: unknown) {
  return run<object>("remove", async () => {
    const parsed = userIdSchema.safeParse(friendId);
    if (!parsed.success) return { ok: false, error: "invalid" };
    await removeFriend(parsed.data);
    return { ok: true };
  });
}
