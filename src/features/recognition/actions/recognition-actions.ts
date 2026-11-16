"use server";

import { auth } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import { identifyGame } from "../identify";
import {
  identifyInputSchema,
  learnBarcodeSchema,
  savePhotoHashSchema,
} from "../schemas";
import type { Candidate } from "../merge";
import {
  createRecognitionDeps,
  learnBarcode,
  listCoverGames,
  savePhotoHash,
  type RecognitionGame,
} from "../services/recognition-service";

/** Result codes are translated by the UI (Recognition.errors.*). */
type Failure<E extends string> = { ok: false; error: E };

export type IdentifyResult =
  | { ok: true; candidates: Candidate[]; bggLimited: boolean }
  | Failure<"unauthenticated" | "invalid" | "failed">;

export type WriteActionResult =
  | { ok: true }
  | Failure<"unauthenticated" | "invalid" | "not_found" | "limit" | "failed">;

/**
 * Candidates for a photo from the three small signals the browser computed. The photo
 * itself never reaches the server: the input schema is strict (barcode, ≤ 3 short lines,
 * a 16-hex image hash and nothing else).
 */
export async function identifyGameAction(
  input: unknown,
): Promise<IdentifyResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthenticated" };

  const parsed = identifyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const result = await identifyGame(
      parsed.data,
      createRecognitionDeps(userId),
    );
    return { ok: true, ...result };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("identifyGame failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function learnBarcodeAction(
  input: unknown,
): Promise<WriteActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthenticated" };

  const parsed = learnBarcodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    return await learnBarcode(parsed.data.gtin, parsed.data.gameId);
  } catch (error) {
    unstable_rethrow(error);
    logger.error("learnBarcode failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function savePhotoHashAction(
  input: unknown,
): Promise<WriteActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthenticated" };

  const parsed = savePhotoHashSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    return await savePhotoHash(parsed.data.gameId, parsed.data.hash);
  } catch (error) {
    unstable_rethrow(error);
    logger.error("savePhotoHash failed", error);
    return { ok: false, error: "failed" };
  }
}

export type ListGamesResult =
  | { ok: true; games: RecognitionGame[] }
  | Failure<"unauthenticated" | "failed">;

/** The games the live camera can recognize (those with a cover). Only called after opt-in. */
export async function listRecognitionGamesAction(): Promise<ListGamesResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthenticated" };
  try {
    return { ok: true, games: await listCoverGames() };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("listRecognitionGames failed", error);
    return { ok: false, error: "failed" };
  }
}
