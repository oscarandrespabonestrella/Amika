"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { getGameSource, importExternalGames } from "@/features/catalog";
import { importCollectionBatch } from "../import-collection";
import { collectionBatchSchema, libraryInputSchema } from "../schemas";
import {
  addLibraryItems,
  removeLibraryItem,
  saveLibraryItem,
} from "../services/library-service";

export type LibraryActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthenticated" | "invalid" | "not_found" | "failed";
    };

export async function saveLibraryItemAction(
  input: unknown,
): Promise<LibraryActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };

    const parsed = libraryInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };

    const outcome = await saveLibraryItem(parsed.data);
    if (outcome !== "saved") return { ok: false, error: outcome };

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("library.save failed", error);
    return { ok: false, error: "failed" };
  }
}

export type ImportBatchActionResult =
  | { ok: true; added: number; existing: number; failed: string[] }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "invalid"
        | "unavailable"
        | "rate_limited"
        | "failed";
    };

/** One batch (≤ 20 games) of a BoardGameGeek collection import. */
export async function importBggCollectionBatchAction(
  rows: unknown,
): Promise<ImportBatchActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };

    const parsed = collectionBatchSchema.safeParse(rows);
    if (!parsed.success) return { ok: false, error: "invalid" };

    const result = await importCollectionBatch(parsed.data, {
      importGames: (ids) => importExternalGames(getGameSource(), ids, userId),
      addItems: addLibraryItems,
    });
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    logger.error("library.importCollection failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function removeLibraryItemAction(
  gameId: unknown,
): Promise<LibraryActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };

    const parsed = z.uuid().safeParse(gameId);
    if (!parsed.success) return { ok: false, error: "invalid" };

    await removeLibraryItem(parsed.data);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    logger.error("library.remove failed", error);
    return { ok: false, error: "failed" };
  }
}
