import { createHash, randomBytes } from "node:crypto";

/** Cookie that identifies a guest browser; only the sha256 of its value reaches the database. */
export const GUEST_COOKIE = "amika_guest";

/** Soft limits on a guest's writes: per guest per minute, per link per hour. */
export const GUEST_LIMITS = { perMinute: 30, perHour: 300 } as const;

/** sha256 as lowercase hex (64 chars), the format the database checks. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** A link token is 32 random bytes in base64url: 43 characters. */
export function isTokenShape(s: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(s);
}

export function newGuestKey(): string {
  return randomBytes(32).toString("base64url");
}

export function isGuestOverLimit(u: {
  lastMinute: number;
  lastHour: number;
}): boolean {
  return (
    u.lastMinute > GUEST_LIMITS.perMinute || u.lastHour > GUEST_LIMITS.perHour
  );
}
