import "server-only";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fromPgCode, type NightErrorCode } from "../error-codes";

export type GuestState = {
  night: {
    title: string;
    startsOn: string;
    hostName: string;
    status: "open" | "closed";
  };
  games: {
    id: string;
    name: string;
    cover: string | null;
    minPlayers: number | null;
    maxPlayers: number | null;
    minPlaytime: number | null;
    maxPlaytime: number | null;
    votes: number;
    voters: string[];
    mine: boolean;
  }[];
  guest: { name: string } | null;
};

export type GuestFailure = { error: NightErrorCode };

function failure(error: { code?: string; message?: string }): GuestFailure {
  // 23514 = the name failed the CHECK (empty after trimming).
  const code: NightErrorCode =
    error.code === "23514" ? "invalid" : fromPgCode(error.code);
  // Only code and message: never details or hint, which can echo arguments.
  if (code === "failed") {
    logger.error("guest rpc failed", error, { message: error.message });
  }
  return { error: code };
}

/** Night as the guest sees it. `link_invalid` when the link is unknown, expired or revoked. */
export async function getGuestState(
  tokenHash: string,
  guestKeyHash: string | null,
): Promise<GuestState | GuestFailure> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "guest_night_state",
    {
      p_token_hash: tokenHash,
      ...(guestKeyHash ? { p_guest_key_hash: guestKeyHash } : {}),
    },
  );
  if (error) return failure(error);
  return data as unknown as GuestState;
}

/** Creates the guest, or renames it when the key already exists. */
export async function guestJoin(
  tokenHash: string,
  name: string,
  guestKeyHash: string,
): Promise<{ ok: true } | GuestFailure> {
  const { error } = await createSupabaseAdminClient().rpc("guest_join_night", {
    p_token_hash: tokenHash,
    p_name: name,
    p_guest_key_hash: guestKeyHash,
  });
  return error ? failure(error) : { ok: true };
}

export async function guestToggleVote(
  tokenHash: string,
  guestKeyHash: string,
  nightGameId: string,
): Promise<{ voted: boolean } | GuestFailure> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "guest_toggle_vote",
    {
      p_token_hash: tokenHash,
      p_guest_key_hash: guestKeyHash,
      p_night_game: nightGameId,
    },
  );
  return error ? failure(error) : { voted: data };
}

export async function guestRename(
  tokenHash: string,
  guestKeyHash: string,
  name: string,
): Promise<{ ok: true } | GuestFailure> {
  const { error } = await createSupabaseAdminClient().rpc("guest_rename", {
    p_token_hash: tokenHash,
    p_guest_key_hash: guestKeyHash,
    p_name: name,
  });
  return error ? failure(error) : { ok: true };
}

/** Logs a write and returns the counts of the soft rate limit (this request included). */
export async function logGuestRequest(
  tokenHash: string,
  guestKeyHash: string,
): Promise<{ lastMinute: number; lastHour: number } | GuestFailure> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "log_night_request",
    { p_token_hash: tokenHash, p_guest_key_hash: guestKeyHash },
  );
  if (error) return failure(error);
  const row = data?.[0];
  return { lastMinute: row?.last_minute ?? 0, lastHour: row?.last_hour ?? 0 };
}
