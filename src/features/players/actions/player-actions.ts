"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { listFriends } from "@/features/friends";
import { linkPlayerToFriend } from "@/features/plays/services/sharing-service";
import { logger } from "@/lib/logger";
import { normalizePlayerName } from "../normalize";
import {
  addFriendPlayerSchema,
  addPlayerSchema,
  ensureMeSchema,
  mergePlayersSchema,
  playerIdSchema,
  renamePlayerSchema,
  setMeSchema,
} from "../schemas";
import {
  addPlayer,
  deletePlayer,
  listPlayers,
  mergePlayers,
  renamePlayer,
  setMe,
} from "../services/player-service";

export type PlayerResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "invalid"
        | "not_found"
        | "exists"
        | "together"
        | "in_use"
        | "me_taken"
        | "failed";
    };

/** Common frame: signed in, run, revalidate; the database (RLS) is the real gatekeeper. */
async function run(
  name: string,
  work: () => Promise<PlayerResult>,
): Promise<PlayerResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const result = await work();
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    logger.error(`players.${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

const done = (outcome: string): PlayerResult =>
  outcome === "ok"
    ? { ok: true }
    : {
        ok: false,
        error: outcome as Extract<PlayerResult, { ok: false }>["error"],
      };

export type AddPlayerResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "unauthenticated" | "invalid" | "exists" | "too_many" | "failed";
    };

/** Adds a named player to the roster (used where a group needs someone not yet played with). */
export async function addPlayerAction(
  input: unknown,
): Promise<AddPlayerResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const parsed = addPlayerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const result = await addPlayer(parsed.data.name);
    if (result.outcome !== "ok") return { ok: false, error: result.outcome };
    revalidatePath("/", "layout");
    return { ok: true, id: result.id };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("players.add failed", error);
    return { ok: false, error: "failed" };
  }
}

export type AddFriendPlayerResult =
  | {
      ok: true;
      id: string;
      /** false: the link request is waiting for the friend to accept. */
      linked: boolean;
    }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "invalid"
        | "exists"
        | "too_many"
        | "not_friend"
        | "failed";
    };

/**
 * Puts a friend in the roster: the player already linked to them, else the unlinked player
 * with the same name, else a new one. Then it asks the friend to confirm the link (the
 * same request as linking from My players): nothing is tied to their account until they
 * accept, but the player can be used in groups and matches right away.
 */
export async function addFriendPlayerAction(
  input: unknown,
): Promise<AddFriendPlayerResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const parsed = addFriendPlayerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const { friendId, name } = parsed.data;

    const [friends, players] = await Promise.all([
      listFriends(),
      listPlayers(),
    ]);
    if (!friends.some((f) => f.userId === friendId))
      return { ok: false, error: "not_friend" };

    const linked = players.find((p) => p.friendId === friendId);
    if (linked) return { ok: true, id: linked.id, linked: true };

    const key = normalizePlayerName(name);
    const same = players.find((p) => normalizePlayerName(p.name) === key);
    if (same && (same.isMe || same.friendId))
      return { ok: false, error: "exists" };

    let id = same?.id;
    if (!id) {
      const added = await addPlayer(name);
      if (added.outcome !== "ok") return { ok: false, error: added.outcome };
      id = added.id;
    }
    const link = await linkPlayerToFriend(id, friendId);
    revalidatePath("/", "layout");
    if ("error" in link)
      return {
        ok: false,
        error: link.error === "not_friend" ? "not_friend" : "failed",
      };
    return { ok: true, id, linked: false };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("players.addFriend failed", error);
    return { ok: false, error: "failed" };
  }
}

/**
 * The player marked "This is me": the existing one, else the unmarked player with the same
 * name, else a new one; the latter two get the mark. Used to put the user in new groups.
 */
export async function ensureMePlayerAction(
  input: unknown,
): Promise<AddPlayerResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const parsed = ensureMeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const players = await listPlayers();
    const me = players.find((p) => p.isMe);
    if (me) return { ok: true, id: me.id };

    const key = normalizePlayerName(parsed.data.name);
    const same = players.find(
      (p) => normalizePlayerName(p.name) === key && !p.friendId,
    );
    let id = same?.id;
    if (!id) {
      const added = await addPlayer(parsed.data.name);
      if (added.outcome !== "ok") return { ok: false, error: added.outcome };
      id = added.id;
    }
    const marked = await setMe(id);
    revalidatePath("/", "layout");
    if (marked !== "ok") return { ok: false, error: "failed" };
    return { ok: true, id };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("players.ensureMe failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function renamePlayerAction(
  input: unknown,
): Promise<PlayerResult> {
  return run("rename", async () => {
    const parsed = renamePlayerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return done(await renamePlayer(parsed.data.playerId, parsed.data.name));
  });
}

export async function mergePlayersAction(
  input: unknown,
): Promise<PlayerResult> {
  return run("merge", async () => {
    const parsed = mergePlayersSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return done(await mergePlayers(parsed.data.keepId, parsed.data.removeId));
  });
}

export async function deletePlayerAction(
  playerId: unknown,
): Promise<PlayerResult> {
  return run("delete", async () => {
    const parsed = playerIdSchema.safeParse(playerId);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return done(await deletePlayer(parsed.data));
  });
}

export async function setMeAction(input: unknown): Promise<PlayerResult> {
  return run("setMe", async () => {
    const parsed = setMeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return done(await setMe(parsed.data.playerId));
  });
}
