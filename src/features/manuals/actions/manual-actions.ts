"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isAdmin } from "@/features/game-center";
import {
  getManualLinkSecret,
  getManualMonthlyCallLimit,
} from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { signManualLink } from "../link-token";
import { createPdfVerifier } from "../pdf-verifier";
import {
  isDownloadOverLimit,
  isSearchOverLimit,
  wouldExceedBudget,
} from "../rate-limit";
import {
  idSchema,
  proposeInputSchema,
  reviewInputSchema,
  searchInputSchema,
} from "../schemas";
import { loadGameIdentity } from "../services/game-identity";
import { createManualSearchService } from "../services/manual-search-service";
import {
  proposeManual,
  type ProposeError,
} from "../services/manual-propose-service";
import * as store from "../services/manual-store";
import { getWebSearchSource } from "../sources";
import type { ManualSearchOutcome } from "../types";

export type SearchActionResult =
  ManualSearchOutcome | { ok: false; error: "unauthenticated" | "invalid" };

export type ManualActionResult =
  | { ok: true; published?: boolean }
  | { ok: false; error: ProposeError | "unauthenticated" | "failed" };

const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

/** Search the web for rulebook PDFs of a game. The browser sends only the game id. */
export async function searchManualsAction(
  input: unknown,
): Promise<SearchActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const parsed = searchInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };

    const secret = getManualLinkSecret();
    const service = createManualSearchService({
      source: getWebSearchSource(),
      verifier: createPdfVerifier(),
      store: { knownUrls: store.knownUrls },
      cache: store.searchCache,
      // Runs only when the paid API is about to be called (a cache hit costs nothing and uses
      // nobody's quota): the user's own limit first, then the app's monthly cap.
      guard: async (calls) => {
        if (isSearchOverLimit(await store.getSearchUsage(userId)))
          return "rate_limited";
        if (
          wouldExceedBudget(
            await store.getApiCallsThisMonth(),
            calls,
            getManualMonthlyCallLimit(),
          )
        )
          return "quota_exhausted";
        await store.recordRequest(userId, "search");
        await store.recordApiCalls(userId, calls);
        return null;
      },
      signLink: secret
        ? (link) => signManualLink({ ...link, userId }, secret)
        : undefined,
    });
    // No key: say so before doing anything else.
    if (!service.isAvailable()) return { ok: false, error: "unavailable" };

    const game = await loadGameIdentity(parsed.data.gameId, await getLocale());
    // Manuals belong to the Game Center, which exists only for catalog games.
    if (!game || game.isCustom) return { ok: false, error: "invalid" };

    return await service.search(game);
  } catch (error) {
    unstable_rethrow(error);
    logger.error("manual search failed", error);
    return { ok: false, error: "failed" };
  }
}

/** An administrator publishes the manual; anyone else proposes it for review. */
export async function proposeManualAction(
  input: unknown,
): Promise<ManualActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const parsed = proposeInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };

    // The server fetches the URL to verify it: that is a download for quota purposes.
    if (isDownloadOverLimit(await store.getDownloadsLastHour(userId)))
      return { ok: false, error: "limit" };
    await store.recordRequest(userId, "download");

    const result = await proposeManual(
      {
        verifier: createPdfVerifier(),
        knownUrls: store.knownUrls,
        insertSuggestion: store.insertSuggestion,
        insertRulesResource: store.insertRulesResource,
        isAdmin: await isAdmin(),
      },
      parsed.data,
    );
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    logger.error("manual proposal failed", error);
    return { ok: false, error: "failed" };
  }
}

/** Administrator: publish a proposal into the Game Center, or reject it. */
export async function reviewManualSuggestionAction(
  input: unknown,
): Promise<ManualActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    if (!(await isAdmin())) return { ok: false, error: "forbidden" };
    const parsed = reviewInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };

    if (parsed.data.decision === "publish")
      await store.publishSuggestion(parsed.data.id);
    else await store.rejectSuggestion(parsed.data.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    if (pgCode(error) === "42501") return { ok: false, error: "forbidden" };
    logger.error("manual review failed", error);
    return { ok: false, error: "failed" };
  }
}

/** The author withdraws their own pending proposal (an administrator may delete any). */
export async function withdrawManualSuggestionAction(
  id: unknown,
): Promise<ManualActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "unauthenticated" };
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return { ok: false, error: "invalid" };
    await store.deleteSuggestion(parsed.data);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    if (pgCode(error) === "42501") return { ok: false, error: "forbidden" };
    logger.error("manual withdraw failed", error);
    return { ok: false, error: "failed" };
  }
}
