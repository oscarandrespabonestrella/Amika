import { auth } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import {
  coverJpeg,
  fetchCoverBytes,
  isAllowedCoverUrl,
} from "@/features/recognition/cover-fetch";
import { handleCoverRequest } from "@/features/recognition/cover-request";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * A game's cover as a small JPEG, for the browser to turn into a recognition vector.
 * Only covers of games the signed-in user can see (RLS) and only on BoardGameGeek's
 * image hosts; nothing is stored. Errors never reveal the cover URL.
 */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/covers/[gameId]">,
) {
  const { gameId } = await ctx.params;
  try {
    const result = await handleCoverRequest(gameId, {
      userId: async () => (await auth()).userId,
      findCoverUrl: async (id) => {
        const { data, error } = await createSupabaseServerClient()
          .from("games")
          .select("cover_url")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return data?.cover_url ?? null;
      },
      isAllowed: isAllowedCoverUrl,
      fetchCover: (url) => fetchCoverBytes(url),
      toJpeg: coverJpeg,
    });
    if (result.status !== 200)
      return new Response(null, { status: result.status });
    return new Response(Buffer.from(result.body), {
      status: 200,
      headers: result.headers,
    });
  } catch (error) {
    unstable_rethrow(error);
    logger.error("cover endpoint failed", error);
    return new Response(null, { status: 502 });
  }
}
