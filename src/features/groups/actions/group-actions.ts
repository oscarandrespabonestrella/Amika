"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import {
  createGroupSchema,
  groupIdSchema,
  renameGroupSchema,
  setMembersSchema,
} from "../schemas";
import {
  createGroup,
  deleteGroup,
  renameGroup,
  setGroupMembers,
} from "../services/group-service";

export type GroupResult =
  | { ok: true; id?: string }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "invalid"
        | "not_found"
        | "exists"
        | "too_many"
        | "failed";
    };

/** Common frame: signed in, run, revalidate; the database (RLS) is the real gatekeeper. */
async function run(
  name: string,
  work: () => Promise<GroupResult>,
): Promise<GroupResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const result = await work();
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    logger.error(`groups.${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

const done = (outcome: string): GroupResult =>
  outcome === "ok"
    ? { ok: true }
    : {
        ok: false,
        error: outcome as Extract<GroupResult, { ok: false }>["error"],
      };

export async function createGroupAction(input: unknown): Promise<GroupResult> {
  return run("create", async () => {
    const parsed = createGroupSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const result = await createGroup(parsed.data.name);
    return result.outcome === "ok"
      ? { ok: true, id: result.id }
      : done(result.outcome);
  });
}

export async function renameGroupAction(input: unknown): Promise<GroupResult> {
  return run("rename", async () => {
    const parsed = renameGroupSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return done(await renameGroup(parsed.data.groupId, parsed.data.name));
  });
}

export async function deleteGroupAction(
  groupId: unknown,
): Promise<GroupResult> {
  return run("delete", async () => {
    const parsed = groupIdSchema.safeParse(groupId);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return done(await deleteGroup(parsed.data));
  });
}

export async function setGroupMembersAction(
  input: unknown,
): Promise<GroupResult> {
  return run("setMembers", async () => {
    const parsed = setMembersSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    return done(
      await setGroupMembers(parsed.data.groupId, parsed.data.playerIds),
    );
  });
}
