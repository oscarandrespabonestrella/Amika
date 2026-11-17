import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import type { ScoreValue } from "@/features/scoring/engine/evaluate";
import { computePlay, type ParticipantInput } from "../compute";
import type { LivePlay } from "../live/merge-play-state";
import { getPlay } from "./play-service";

export type ShareError =
  | "not_found"
  | "not_friend"
  | "custom_game"
  | "already_invited"
  | "closed"
  | "limit"
  | "invalid";

const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

/** Database codes (migrations 0023/0024) → what the screen says. Null: unexpected, rethrow. */
function mapShareError(code: string | undefined): ShareError | null {
  switch (code) {
    case "PI001":
      return "not_friend";
    case "PI002":
      return "custom_game";
    case "PI003":
      return "already_invited";
    case "PI005":
      return "closed";
    case "PI004":
    case "P0001":
      return "limit";
    case "42501":
    case "P0002":
      return "not_found";
    default:
      return null;
  }
}

async function call<T>(
  work: () => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null } | { error: ShareError }> {
  const { data, error } = await work();
  if (error) {
    const mapped = mapShareError(pgCode(error));
    if (mapped) return { error: mapped };
    throw error;
  }
  return { data };
}

const db = () => createSupabaseServerClient();

export async function inviteToPlay(
  playId: string,
  friendId: string,
  seat: number,
) {
  return call(() =>
    db().rpc("invite_to_play", {
      p_play: playId,
      p_friend: friendId,
      p_seat: seat,
    }),
  );
}

export async function respondPlayInvite(memberId: string, accept: boolean) {
  return call(() =>
    db().rpc("respond_play_invite", { p_member: memberId, p_accept: accept }),
  );
}

export async function leavePlay(playId: string) {
  return call(() => db().rpc("leave_play", { p_play: playId }));
}

export type PlayInvite = {
  memberId: string;
  playId: string;
  gameName: string;
  invitedByName: string;
  invitedAt: string;
};

export async function listMyInvites(): Promise<PlayInvite[]> {
  const { data, error } = await db().rpc("list_my_invites");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    memberId: r.member_id,
    playId: r.play_id,
    gameName: r.game_name,
    invitedByName: r.invited_by_name,
    invitedAt: r.invited_at,
  }));
}

export type LinkRequest = {
  requestId: string;
  ownerName: string;
  playerName: string;
  plays: number;
};

export async function listMyLinkRequests(): Promise<LinkRequest[]> {
  const { data, error } = await db().rpc("list_my_link_requests");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    requestId: r.request_id,
    ownerName: r.owner_name,
    playerName: r.player_name,
    plays: r.plays,
  }));
}

export async function linkPlayerToFriend(playerId: string, friendId: string) {
  return call(() =>
    db().rpc("link_player_to_friend", {
      p_player: playerId,
      p_friend: friendId,
    }),
  );
}

export async function respondPlayerLink(requestId: string, accept: boolean) {
  return call(() =>
    db().rpc("respond_player_link", {
      p_request: requestId,
      p_accept: accept,
    }),
  );
}

export async function unlinkPlayer(playerId: string) {
  return call(() => db().rpc("unlink_player", { p_player: playerId }));
}

/**
 * A member writes THEIR column. The values are checked against the match's sheet with the
 * same engine that scores matches; nothing but the known categories is stored.
 */
export async function saveMyScores(
  playId: string,
  values: Record<string, ScoreValue>,
) {
  const { userId } = await auth();
  const play = await getPlay(playId);
  if (!userId || !play) return { error: "not_found" as const };
  if (play.status !== "open") return { error: "closed" as const };
  if (!play.sheet) return { error: "invalid" as const };
  if (!play.entries.some((e) => e.userId === userId))
    return { error: "not_found" as const };

  const computed = computePlay(play.sheet.definition, [{ name: "me", values }]);
  if (!computed.ok) return { error: "invalid" as const };
  return call(() =>
    db().rpc("save_my_scores", {
      p_play: playId,
      p_scores: computed.participants[0].scores as unknown as Json,
    }),
  );
}

/**
 * The owner closes a match. Totals, ranks and winners are computed HERE from what is stored
 * (the browser's provisional totals are never trusted) and handed to `close_play`.
 */
export async function closePlay(playId: string) {
  const { userId } = await auth();
  const play = await getPlay(playId);
  if (!userId || !play || play.ownerId !== userId)
    return { error: "not_found" as const };

  const computed = computePlay(
    play.sheet?.definition ?? null,
    play.entries.map((e): ParticipantInput => ({
      name: e.name,
      values: e.values,
      manualTotal: e.manualTotal,
    })),
  );
  if (!computed.ok) return { error: "invalid" as const };
  return call(() =>
    db().rpc("close_play", {
      p_play: playId,
      p: {
        participants: computed.participants.map((p) => ({
          seat: p.seat,
          total: p.total,
          rank: p.rank,
          isWinner: p.isWinner,
        })),
      } as unknown as Json,
    }),
  );
}

export type ElsewherePlay = {
  playId: string;
  gameId: string;
  gameName: string;
  playedOn: string;
  status: "open" | "closed";
  ownerName: string;
};

/**
 * "Played at a friend's house": matches I belong to but do not own, of games that are not in
 * my library. A match of a game I do have appears in my normal history instead.
 */
export async function listElsewherePlays(): Promise<ElsewherePlay[]> {
  const { userId } = await auth();
  if (!userId) return [];
  const client = db();
  const [plays, library] = await Promise.all([
    client
      .from("plays")
      .select(
        "id, game_id, played_on, status, owner_id, games!plays_game_id_fkey(name)",
      )
      .neq("owner_id", userId)
      .order("played_on", { ascending: false })
      .limit(200),
    client.from("library_items").select("game_id"),
  ]);
  if (plays.error) throw plays.error;
  if (library.error) throw library.error;
  const owned = new Set((library.data ?? []).map((l) => l.game_id));
  const rows = (plays.data ?? []).filter((p) => !owned.has(p.game_id));

  const ownerIds = [...new Set(rows.map((r) => r.owner_id))].filter(
    (id): id is string => !!id,
  );
  const names = new Map<string, string>();
  if (ownerIds.length) {
    // the owner is not necessarily my friend: their name comes from the match itself
    const { data } = await client
      .from("play_participants")
      .select("user_id, display_name")
      .in("user_id", ownerIds);
    for (const p of data ?? [])
      if (p.user_id) names.set(p.user_id, p.display_name);
  }
  return rows.map((r) => ({
    playId: r.id,
    gameId: r.game_id,
    gameName: r.games?.name ?? "",
    playedOn: r.played_on,
    status: r.status as "open" | "closed",
    ownerName: (r.owner_id && names.get(r.owner_id)) || "",
  }));
}

/** The whole state of a live match, for the first render and for every re-read (RLS applies). */
export async function getLivePlay(playId: string): Promise<LivePlay | null> {
  const { data, error } = await db()
    .from("plays")
    .select(
      "id, status, play_participants(id, seat, display_name, user_id, total_score, play_scores(category_key, value)), play_members(user_id, status)",
    )
    .eq("id", playId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    status: data.status as "open" | "closed",
    participants: [...data.play_participants]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id,
        seat: p.seat,
        name: p.display_name,
        userId: p.user_id,
        total: p.total_score,
        scores: Object.fromEntries(
          p.play_scores.map((s) => [s.category_key, s.value]),
        ),
      })),
    members: data.play_members.map((m) => ({
      userId: m.user_id,
      status: m.status,
    })),
  };
}
