import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { NightErrorCode } from "@/features/nights/error-codes";
import {
  getGuestState,
  guestJoin,
  guestRename,
  guestToggleVote,
  logGuestRequest,
  type GuestFailure,
} from "@/features/nights/guest/guest-service";
import {
  GUEST_COOKIE,
  hashSecret,
  isGuestOverLimit,
  isTokenShape,
  newGuestKey,
} from "@/features/nights/guest/token";
import { guestNameSchema, idSchema } from "@/features/nights/schemas";
import { logger } from "@/lib/logger";

/**
 * Public, unauthenticated surface of a game night: a guest with the shared link reads the
 * night and votes. The browser talks only to this route; the route checks the token shape,
 * the guest cookie and the rate limit, then calls SQL functions that only service_role can
 * run. Neither the token, the guest key nor their hashes are ever logged.
 */

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), name: guestNameSchema }),
  z.object({ action: z.literal("vote"), nightGameId: idSchema }),
  z.object({ action: z.literal("rename"), name: guestNameSchema }),
]);

const MAX_BODY = 1024;

type Ctx = { params: Promise<{ token: string }> };

const STATUS: Partial<Record<NightErrorCode, number>> = {
  link_invalid: 404,
  not_found: 404,
  limit: 409,
  closed: 409,
  invalid: 400,
  rate_limited: 429,
};

function reply(
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      ...extra,
    },
  });
}

function fail(code: NightErrorCode, extra?: Record<string, string>) {
  return reply({ error: code }, STATUS[code] ?? 500, extra);
}

function isFailure(value: object): value is GuestFailure {
  return "error" in value;
}

/** The night closes, and the link expires, at 00:00 UTC two days after it starts. */
function linkExpiry(startsOn: string): Date {
  const [y, m, d] = startsOn.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 2));
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const noStore = { "Cache-Control": "no-store" };
  const { token } = await params;
  if (!isTokenShape(token)) return fail("link_invalid", noStore);
  try {
    const key = req.cookies.get(GUEST_COOKIE)?.value;
    const state = await getGuestState(
      hashSecret(token),
      key ? hashSecret(key) : null,
    );
    if (isFailure(state)) return fail(state.error, noStore);
    return reply(state, 200, noStore);
  } catch (error) {
    unstable_rethrow(error);
    logger.error("guest night state failed", error);
    return fail("failed", noStore);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { token } = await params;
  if (!isTokenShape(token)) return fail("link_invalid");

  // CSRF: only same-origin JSON. A cross-site form could otherwise replace the guest cookie.
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    return reply({ error: "unsupported_media_type" }, 415);
  }
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (
    (origin !== null && origin !== req.nextUrl.origin) ||
    site === "cross-site" ||
    site === "same-site"
  ) {
    return reply({ error: "forbidden" }, 403);
  }

  const text = await req.text();
  if (text.length > MAX_BODY) return reply({ error: "too_large" }, 413);
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const body = bodySchema.safeParse(json);
  if (!body.success) return fail("invalid");
  const input = body.data;

  const raw = req.cookies.get(GUEST_COOKIE)?.value;
  const cookieKey = raw && isTokenShape(raw) ? raw : undefined;
  if (input.action !== "join" && !cookieKey) {
    return reply({ error: "no_guest" }, 401);
  }
  // Joining without a cookie makes a new guest; a cookie renames the existing one.
  const key = cookieKey ?? newGuestKey();
  const tokenHash = hashSecret(token);
  const keyHash = hashSecret(key);

  try {
    // Log before writing, so a flood is counted even when the write fails.
    const usage = await logGuestRequest(tokenHash, keyHash);
    if (isFailure(usage)) return fail(usage.error);
    if (isGuestOverLimit(usage)) return fail("rate_limited");

    if (input.action === "vote") {
      const result = await guestToggleVote(
        tokenHash,
        keyHash,
        input.nightGameId,
      );
      return isFailure(result) ? fail(result.error) : reply(result, 200);
    }
    if (input.action === "rename") {
      const result = await guestRename(tokenHash, keyHash, input.name);
      return isFailure(result) ? fail(result.error) : reply({ ok: true }, 200);
    }

    const joined = await guestJoin(tokenHash, input.name, keyHash);
    if (isFailure(joined)) return fail(joined.error);
    // The guest exists now: always hand out the cookie, even if the state read fails.
    const state = await getGuestState(tokenHash, keyHash);
    const response = isFailure(state)
      ? reply({ ok: true }, 200)
      : reply(state, 200);
    response.cookies.set(GUEST_COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: `/api/nights/guest/${token}`,
      expires: isFailure(state)
        ? new Date(Date.now() + 3 * 24 * 3600 * 1000)
        : linkExpiry(state.night.startsOn),
    });
    return response;
  } catch (error) {
    unstable_rethrow(error);
    logger.error("guest night write failed", error);
    return fail("failed");
  }
}
