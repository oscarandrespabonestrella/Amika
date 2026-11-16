"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import { sheetIdSchema, voteSchema } from "../schemas";
import {
  castVote,
  clearVote,
  publishSheet,
  setSheetDisabled,
  setSheetVerified,
  unpublishSheet,
} from "../services/community-service";

export type CommunityResult<T extends object = object> =
  | ({ ok: true } & T)
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "invalid"
        | "not_found"
        | "custom_game"
        | "daily_limit"
        | "own_sheet"
        | "no_match"
        | "forbidden"
        | "failed";
    };

/** Common frame: signed in, run, revalidate; the database (RLS) is the real gatekeeper. */
async function run(
  name: string,
  work: () => Promise<CommunityResult>,
): Promise<CommunityResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const result = await work();
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    logger.error(`community.${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

const done = (outcome: string): CommunityResult =>
  outcome === "ok"
    ? { ok: true }
    : {
        ok: false,
        error: outcome as Extract<CommunityResult, { ok: false }>["error"],
      };

export async function publishSheetAction(
  sheetId: unknown,
): Promise<CommunityResult> {
  return run("publish", async () => {
    const parsed = sheetIdSchema.safeParse(sheetId);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return done(await publishSheet(parsed.data));
  });
}

export async function unpublishSheetAction(
  sheetId: unknown,
): Promise<CommunityResult> {
  return run("unpublish", async () => {
    const parsed = sheetIdSchema.safeParse(sheetId);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return done(await unpublishSheet(parsed.data));
  });
}

export async function voteAction(input: unknown): Promise<CommunityResult> {
  return run("vote", async () => {
    const parsed = voteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return done(await castVote(parsed.data));
  });
}

export async function clearVoteAction(
  versionId: unknown,
): Promise<CommunityResult> {
  return run("clearVote", async () => {
    const parsed = sheetIdSchema.safeParse(versionId);
    if (!parsed.success) return { ok: false, error: "invalid" };
    await clearVote(parsed.data);
    return { ok: true };
  });
}

export async function setVerifiedAction(
  sheetId: unknown,
  verified: unknown,
): Promise<CommunityResult> {
  return run("verify", async () => {
    const parsed = sheetIdSchema.safeParse(sheetId);
    if (!parsed.success || typeof verified !== "boolean")
      return { ok: false, error: "invalid" };
    return done(await setSheetVerified(parsed.data, verified));
  });
}

export async function setDisabledAction(
  sheetId: unknown,
  disabled: unknown,
): Promise<CommunityResult> {
  return run("disable", async () => {
    const parsed = sheetIdSchema.safeParse(sheetId);
    if (!parsed.success || typeof disabled !== "boolean")
      return { ok: false, error: "invalid" };
    return done(await setSheetDisabled(parsed.data, disabled));
  });
}
