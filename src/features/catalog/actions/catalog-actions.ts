"use server";

import { auth } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import { bggQuerySchema, customGameSchema, externalIdSchema } from "../schemas";
import { createCustomGame } from "../services/game-service";
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

export async function createCustomGameAction(
  input: unknown,
): Promise<CreateCustomGameResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthenticated" };

  const parsed = customGameSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, error: "invalid", fieldErrors };
  }

  try {
    return { ok: true, id: await createCustomGame(userId, parsed.data) };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("createCustomGame failed", error);
    return { ok: false, error: "failed" };
  }
}
