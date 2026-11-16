"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { logger } from "@/lib/logger";
import { validateDefinition, type DefinitionIssue } from "../engine/validate";
import {
  sheetCreateSchema,
  sheetIdSchema,
  sheetRenameSchema,
  sheetVersionSchema,
} from "../schemas";
import {
  copySheet,
  createSheet,
  deleteSheet,
  renameSheet,
  saveSheetVersion,
} from "../services/sheet-service";

export type ScoringResult<T extends object = object> =
  | ({ ok: true } & T)
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "invalid"
        | "not_found"
        | "conflict"
        | "limit"
        | "in_use"
        | "failed";
      issues?: DefinitionIssue[];
    };

type Failure = Extract<ScoringResult, { ok: false }>;

/** Common frame: signed in, run, revalidate; the database (RLS) is the real gatekeeper. */
async function run<T extends object>(
  name: string,
  work: () => Promise<ScoringResult<T>>,
): Promise<ScoringResult<T>> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const result = await work();
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    logger.error(`scoring.${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

const invalid = (issues?: DefinitionIssue[]): Failure => ({
  ok: false,
  error: "invalid",
  issues,
});

export async function createSheetAction(
  input: unknown,
): Promise<ScoringResult<{ sheetId: string }>> {
  return run("create", async () => {
    const parsed = sheetCreateSchema.safeParse(input);
    if (!parsed.success) return invalid();
    const definition = validateDefinition(parsed.data.definition);
    if (!definition.ok) return invalid(definition.issues);

    const outcome = await createSheet({
      gameId: parsed.data.gameId,
      title: parsed.data.title,
      locale: parsed.data.locale,
      definition: definition.definition,
    });
    if (typeof outcome === "string") return { ok: false, error: outcome };
    return { ok: true, sheetId: outcome.sheetId };
  });
}

export async function saveSheetVersionAction(
  input: unknown,
): Promise<ScoringResult<{ version: number }>> {
  return run("saveVersion", async () => {
    const parsed = sheetVersionSchema.safeParse(input);
    if (!parsed.success) return invalid();
    const definition = validateDefinition(parsed.data.definition);
    if (!definition.ok) return invalid(definition.issues);

    const outcome = await saveSheetVersion(
      parsed.data.sheetId,
      definition.definition,
      parsed.data.baseVersion,
    );
    if (typeof outcome === "string") return { ok: false, error: outcome };
    return { ok: true, version: outcome.version };
  });
}

export async function renameSheetAction(
  input: unknown,
): Promise<ScoringResult> {
  return run("rename", async () => {
    const parsed = sheetRenameSchema.safeParse(input);
    if (!parsed.success) return invalid();
    const outcome = await renameSheet(
      parsed.data.sheetId,
      parsed.data.title,
      parsed.data.locale,
    );
    return outcome === "saved" ? { ok: true } : { ok: false, error: outcome };
  });
}

export async function deleteSheetAction(
  sheetId: unknown,
): Promise<ScoringResult> {
  return run("delete", async () => {
    const parsed = sheetIdSchema.safeParse(sheetId);
    if (!parsed.success) return invalid();
    const outcome = await deleteSheet(parsed.data);
    return outcome === "deleted" ? { ok: true } : { ok: false, error: outcome };
  });
}

export async function copySheetAction(
  sheetId: unknown,
): Promise<ScoringResult<{ sheetId: string }>> {
  return run("copy", async () => {
    const parsed = sheetIdSchema.safeParse(sheetId);
    if (!parsed.success) return invalid();
    // The title comes from the stored sheet, never from the client.
    const suffix = (await getTranslations("Scoring"))("copySuffix");

    const outcome = await copySheet(parsed.data, suffix);
    if (typeof outcome === "string") return { ok: false, error: outcome };
    return { ok: true, sheetId: outcome.sheetId };
  });
}
