"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { bggQuerySchema, customGameSchema, externalIdSchema } from "../schemas";
import {
  createCustomGame,
  deleteCustomGame,
  updateCustomGame,
} from "../services/game-service";
import {
  type ExternalSearchResult,
  type ImportResult,
  importExternalGame,
  searchExternalGames,
} from "../services/import-service";
import { getGameSource } from "../sources";

/** Result codes are translated by the UI (Games.errors.*). */
type Unauthenticated = { ok: false; error: "unauthenticated" };
type Invalid = { ok: false; error: "invalid" };

export async function searchExternalAction(
  query: unknown,
): Promise<ExternalSearchResult | Unauthenticated | Invalid> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthenticated" };

  const parsed = bggQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false, error: "invalid" };

  return searchExternalGames(getGameSource(), parsed.data, userId);
}

export async function importGameAction(
  externalId: unknown,
): Promise<ImportResult | Unauthenticated | Invalid> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthenticated" };

  const parsed = externalIdSchema.safeParse(externalId);
  if (!parsed.success) return { ok: false, error: "invalid" };

  return importExternalGame(getGameSource(), parsed.data, userId);
}

export type CreateCustomGameResult =
  | { ok: true; id: string }
  | Unauthenticated
  | { ok: false; error: "invalid"; fieldErrors: Record<string, string> }
  | { ok: false; error: "failed" };

/** First message per field: the form shows one error under each input. */
function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "form");
    fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

export async function createCustomGameAction(
  input: unknown,
): Promise<CreateCustomGameResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthenticated" };

  const parsed = customGameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const id = await createCustomGame(userId, parsed.data);
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("createCustomGame failed", error);
    return { ok: false, error: "failed" };
  }
}

export type UpdateCustomGameResult =
  | { ok: true }
  | Unauthenticated
  | { ok: false; error: "invalid"; fieldErrors: Record<string, string> }
  | { ok: false; error: "not_found" | "failed" };

export async function updateCustomGameAction(
  id: unknown,
  input: unknown,
): Promise<UpdateCustomGameResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthenticated" };

  const gameId = z.uuid().safeParse(id);
  if (!gameId.success) return { ok: false, error: "not_found" };
  const parsed = customGameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const outcome = await updateCustomGame(gameId.data, parsed.data);
    if (outcome === "not_found") return { ok: false, error: "not_found" };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("updateCustomGame failed", error);
    return { ok: false, error: "failed" };
  }
}

export type DeleteCustomGameResult =
  { ok: true } | Unauthenticated | { ok: false; error: "not_found" | "failed" };

export async function deleteCustomGameAction(
  id: unknown,
): Promise<DeleteCustomGameResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthenticated" };

  try {
    const outcome = await deleteCustomGame(userId, String(id));
    if (outcome === "not_found") return { ok: false, error: "not_found" };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("deleteCustomGame failed", error);
    return { ok: false, error: "failed" };
  }
}
