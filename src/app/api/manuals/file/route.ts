import { auth } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import {
  FILE_MAX_BYTES,
  FILE_TIMEOUT_MS,
  handleFileRequest,
} from "@/features/manuals/file-request";
import { verifyManualLink } from "@/features/manuals/link-token";
import { openPdf } from "@/features/manuals/pdf-verifier";
import { isDownloadOverLimit } from "@/features/manuals/rate-limit";
import { idSchema } from "@/features/manuals/schemas";
import * as store from "@/features/manuals/services/manual-store";
import { getManualLinkSecret } from "@/lib/env/server";
import { logger } from "@/lib/logger";

// A large PDF from a slow publisher can take a while; the body is streamed, so Vercel's
// 4.5 MB response limit does not apply (https://vercel.com/docs/functions/limitations).
export const maxDuration = 60;

/**
 * A manual PDF fetched in transit for the browser to save on the device (download or offline
 * copy). Never stored on our side. See `file-request.ts` for the rules.
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams;
  try {
    const secret = getManualLinkSecret();
    const result = await handleFileRequest(
      {
        resource: query.get("resource"),
        suggestion: query.get("suggestion"),
        token: query.get("token"),
      },
      {
        userId: async () => (await auth()).userId,
        urlOfResource: store.urlOfResource,
        urlOfSuggestion: store.urlOfSuggestion,
        verifyToken: secret
          ? (token) => verifyManualLink(token, secret)
          : undefined,
        isOverLimit: async (userId) =>
          isDownloadOverLimit(await store.getDownloadsLastHour(userId)),
        recordDownload: (userId) => store.recordRequest(userId, "download"),
        open: (url) =>
          openPdf(url, {
            maxBytes: FILE_MAX_BYTES,
            timeoutMs: FILE_TIMEOUT_MS,
          }),
        isId: (value) => idSchema.safeParse(value).success,
      },
    );
    if (result.status !== 200)
      return new Response(null, { status: result.status });
    return new Response(result.stream, {
      status: 200,
      headers: result.headers,
    });
  } catch (error) {
    unstable_rethrow(error);
    logger.error("manual file endpoint failed", error);
    return new Response(null, { status: 502 });
  }
}
