"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import {
  addPlayerSchema,
  mergePlayersSchema,
  playerIdSchema,
  renamePlayerSchema,
  setMeSchema,
} from "../schemas";
import {
  addPlayer,
  deletePlayer,
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
