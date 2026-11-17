import { z } from "zod";

/** A friend link code: two UUIDs without dashes (64 hex characters). */
export const friendCodeSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** A Clerk user id; opaque to us, bounded to keep garbage out of the database. */
export const userIdSchema = z.string().min(1).max(200);
