import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// The download proxy must never be an open proxy. A search result carries a token that says
// "THIS user may fetch THIS url for THIS game for the next hour", signed with a server-only
// secret. The proxy accepts only that, or an id of a manual that is already in the database.

export const LINK_TTL_MS = 60 * 60 * 1000;

type Claims = { u: string; g: string; s: string; e: number };
export type ManualLink = { url: string; gameId: string; userId: string };

const b64 = (buf: Buffer) => buf.toString("base64url");

function mac(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function signManualLink(
  link: ManualLink,
  secret: string,
  now: number = Date.now(),
): string {
  const claims: Claims = {
    u: link.url,
    g: link.gameId,
    s: link.userId,
    e: now + LINK_TTL_MS,
  };
  const payload = b64(Buffer.from(JSON.stringify(claims)));
  return `${payload}.${b64(mac(payload, secret))}`;
}

/** The signed link, or null if the token is forged, malformed or expired. */
export function verifyManualLink(
  token: string,
  secret: string,
  now: number = Date.now(),
): ManualLink | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = mac(payload, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<Claims>;
    if (
      typeof claims.u !== "string" ||
      typeof claims.g !== "string" ||
      typeof claims.s !== "string" ||
      typeof claims.e !== "number" ||
      claims.e < now
    )
      return null;
    return { url: claims.u, gameId: claims.g, userId: claims.s };
  } catch {
    return null;
  }
}
