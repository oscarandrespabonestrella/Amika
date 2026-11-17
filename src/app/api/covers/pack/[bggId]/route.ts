import { auth } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import {
  coverJpeg,
  fetchCoverBytes,
  isAllowedCoverUrl,
} from "@/features/recognition/cover-fetch";
import { handlePackCoverRequest } from "@/features/recognition/cover-request";
import { packCoverUrl } from "@/features/recognition/pack/manifest";
import { logger } from "@/lib/logger";

/**
 * The cover of a game of the reference pack (BoardGameGeek's top 500) as a small JPEG, for
 * the browser's geometric verification. The URL comes from the committed manifest, never
 * from the request; only BoardGameGeek's image hosts; nothing is stored.
 */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/covers/pack/[bggId]">,
) {
  const { bggId } = await ctx.params;
  try {
    const result = await handlePackCoverRequest(bggId, {
      userId: async () => (await auth()).userId,
      packCoverUrl,
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
    logger.error("pack cover endpoint failed", error);
    return new Response(null, { status: 502 });
  }
}
