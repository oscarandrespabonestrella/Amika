import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fromPgCode, type NightErrorCode } from "../error-codes";
import { rankCandidates, type Ranked } from "../rank";
import type { NightInput, PickerQuery } from "../schemas";

/** A failure the screens can explain: thrown by the services, caught by the actions. */
export class NightError extends Error {
  constructor(readonly code: NightErrorCode) {
    super(`night error: ${code}`);
    this.name = "NightError";
  }
}

export type NightSummary = {
  id: string;
  title: string;
  startsOn: string;
  status: "open" | "closed";
  isOwner: boolean;
  games: number;
};

export type NightInvite = {
  nightId: string;
  title: string;
  startsOn: string;
  hostName: string;
};

export type NightDetail = {
  id: string;
  title: string;
  startsOn: string;
  status: "open" | "closed";
  isOwner: boolean;
  hostName: string;
  players: number | null;
  maxMinutes: number | null;
  groupId: string | null;
  /** Host only: end of validity of the active link, null if none or not the host. */
  linkExpiresAt: string | null;
  games: {
    id: string;
    gameId: string;
    name: string;
    coverUrl: string | null;
    source: "host" | "suggested";
    pinned: boolean;
    played: boolean;
    votes: number;
    voters: string[];
    mine: boolean;
  }[];
  members: { userId: string; name: string; status: string }[];
};

const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

/** Throws a NightError for the codes the night functions raise, the raw error otherwise. */
function fail(error: unknown): never {
  const code = fromPgCode(pgCode(error));
  if (code === "failed") throw error;
  throw new NightError(code);
}

const MS_PER_DAY = 86_400_000;

/** Closed by hand, or past the end of the day after `starts_on` (UTC), like `night_is_open`. */
function statusOf(status: string, startsOn: string): "open" | "closed" {
  const end = Date.parse(`${startsOn}T00:00:00Z`) + 2 * MS_PER_DAY;
  return status === "open" && Date.now() < end ? "open" : "closed";
}

async function currentUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new NightError("unauthenticated");
  return userId;
}

async function groupPlayerCount(groupId: string): Promise<number | undefined> {
  const { data, error } = await createSupabaseServerClient()
    .from("player_group_members")
    .select("player_id")
    .eq("group_id", groupId);
  if (error) throw error;
  return data.length > 0 ? Math.min(data.length, 100) : undefined;
}

/** The selector's shortlist: owned games that fit, best first. */
export async function getPickerShortlist(
  q: PickerQuery,
  today: string,
): Promise<Ranked[]> {
  const players = q.groupId ? await groupPlayerCount(q.groupId) : q.players;
  const { data, error } = await createSupabaseServerClient().rpc(
    "picker_candidates",
    { p_players: players, p_max_minutes: q.maxMinutes },
  );
  if (error) throw error;
  return rankCandidates(
    (data ?? []).map((r) => ({
      gameId: r.game_id,
      name: r.name,
      coverUrl: r.cover_url,
      isCustom: r.is_custom,
      minPlayers: r.min_players,
      maxPlayers: r.max_players,
      minPlaytime: r.min_playtime,
      maxPlaytime: r.max_playtime,
      isFavorite: r.is_favorite,
      rating: r.rating,
      playCount: r.play_count,
      lastPlayedOn: r.last_played_on,
    })),
    { today, players },
  );
}

/** My nights and the ones I joined (RLS), latest first. */
export async function listNights(): Promise<NightSummary[]> {
  const me = await currentUserId();
  const { data, error } = await createSupabaseServerClient()
    .from("game_nights")
    .select("id, title, starts_on, status, owner_id, game_night_games(id)")
    .order("starts_on", { ascending: false });
  if (error) throw error;
  return data.map((n) => ({
    id: n.id,
    title: n.title,
    startsOn: n.starts_on,
    status: statusOf(n.status, n.starts_on),
    isOwner: n.owner_id === me,
    games: n.game_night_games.length,
  }));
}

export async function getNight(id: string): Promise<NightDetail | null> {
  const me = await currentUserId();
  const supabase = createSupabaseServerClient();
  const { data: night, error } = await supabase
    .from("game_nights")
    .select(
      "id, title, starts_on, status, owner_id, players, max_minutes, group_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!night) return null;

  const isOwner = night.owner_id === me;
  const [games, members, votes, voters, friends, profile] = await Promise.all([
    supabase
      .from("game_night_games")
      .select(
        "id, game_id, name_snapshot, cover_snapshot, source, pinned, played, created_at",
      )
      .eq("night_id", id)
      .order("created_at"),
    // Only the host sees the member list (they are all the host's friends).
    isOwner
      ? supabase
          .from("game_night_members")
          .select("user_id, status")
          .eq("night_id", id)
          .order("invited_at")
      : Promise.resolve({ data: [], error: null }),
    supabase.from("game_night_votes").select("night_game_id, user_id"),
    supabase.rpc("night_votes", { p_night: id }),
    supabase.rpc("list_friends"),
    supabase.from("profiles").select("display_name").eq("id", me).maybeSingle(),
  ]);
  for (const r of [games, members, votes, voters, friends, profile]) {
    if (r.error) throw r.error;
  }

  // Names: mine from my profile, the rest from my friends (host and members are friends).
  const names = new Map<string, string>();
  for (const f of friends.data ?? []) names.set(f.user_id, f.display_name);
  names.set(me, profile.data?.display_name ?? "");

  const gameIds = new Set((games.data ?? []).map((g) => g.id));
  const count = new Map<string, number>();
  const mine = new Set<string>();
  for (const v of votes.data ?? []) {
    if (!gameIds.has(v.night_game_id)) continue;
    count.set(v.night_game_id, (count.get(v.night_game_id) ?? 0) + 1);
    if (v.user_id === me) mine.add(v.night_game_id);
  }
  const namesByGame = new Map<string, string[]>();
  for (const v of voters.data ?? []) {
    const list = namesByGame.get(v.night_game_id) ?? [];
    list.push(v.voter_name);
    namesByGame.set(v.night_game_id, list);
  }

  let linkExpiresAt: string | null = null;
  if (isOwner) {
    // The links table is private to clients. The admin client is safe here: the RLS
    // client already returned this night and its owner is the signed-in user. Only the
    // existence of an active link is read, never token_hash. Validity follows the
    // night (starts_on + 2 days, 00:00 UTC); the stored expires_at is informational.
    const { data: link, error: linkError } = await createSupabaseAdminClient()
      .from("game_night_links")
      .select("id")
      .eq("night_id", night.id)
      .is("revoked_at", null)
      .maybeSingle();
    if (linkError) throw linkError;
    if (link) {
      linkExpiresAt = new Date(
        Date.parse(`${night.starts_on}T00:00:00Z`) + 2 * MS_PER_DAY,
      ).toISOString();
    }
  }

  return {
    id: night.id,
    title: night.title,
    startsOn: night.starts_on,
    status: statusOf(night.status, night.starts_on),
    isOwner,
    hostName: names.get(night.owner_id) ?? "",
    players: night.players,
    maxMinutes: night.max_minutes,
    groupId: night.group_id,
    linkExpiresAt,
    games: (games.data ?? []).map((g) => ({
      id: g.id,
      gameId: g.game_id,
      name: g.name_snapshot,
      coverUrl: g.cover_snapshot,
      source: g.source === "suggested" ? "suggested" : "host",
      pinned: g.pinned,
      played: g.played,
      votes: count.get(g.id) ?? 0,
      voters: namesByGame.get(g.id) ?? [],
      mine: mine.has(g.id),
    })),
    members: (members.data ?? []).map((m) => ({
      userId: m.user_id,
      name: names.get(m.user_id) ?? "",
      status: m.status,
    })),
  };
}

export async function createNight(
  input: NightInput,
): Promise<{ id: string } | { error: NightErrorCode }> {
  const me = await currentUserId();
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("game_nights")
    .insert({
      title: input.title,
      starts_on: input.startsOn,
      players: input.players ?? null,
      max_minutes: input.maxMinutes ?? null,
      group_id: input.groupId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    const code = fromPgCode(pgCode(error));
    if (code === "failed") throw error;
    return { error: code };
  }

  // The snapshot of name and cover is filled by a trigger when missing.
  const rows = input.gameIds.map((game_id) => ({
    night_id: data.id,
    game_id,
    source: "host",
    added_by: me,
  })) as unknown as {
    night_id: string;
    game_id: string;
    source: string;
    name_snapshot: string;
  }[];
  const { error: gamesError } = await supabase
    .from("game_night_games")
    .insert(rows);
  if (gamesError) {
    // Do not leave a night without its games behind.
    await supabase.from("game_nights").delete().eq("id", data.id);
    const code = fromPgCode(pgCode(gamesError));
    if (code === "failed") throw gamesError;
    return { error: code };
  }
  return { id: data.id };
}

/** Host only (RLS): pin / mark played, or take the game off the night. */
export async function setNightGame(
  nightId: string,
  gameId: string,
  change: { pinned?: boolean; played?: boolean } | "remove",
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const table = supabase.from("game_night_games");
  const query = change === "remove" ? table.delete() : table.update(change);
  const { data, error } = await query
    .eq("night_id", nightId)
    .eq("game_id", gameId)
    .select("id");
  if (error) fail(error);
  if (data.length === 0) throw new NightError("not_found");
}

export async function closeNight(id: string): Promise<void> {
  const { data, error } = await createSupabaseServerClient()
    .from("game_nights")
    .update({ status: "closed" })
    .eq("id", id)
    .select("id");
  if (error) fail(error);
  if (data.length === 0) throw new NightError("not_found");
}

export async function inviteToNight(
  nightId: string,
  friendId: string,
): Promise<void> {
  const { error } = await createSupabaseServerClient().rpc("invite_to_night", {
    p_night: nightId,
    p_friend: friendId,
  });
  if (error) fail(error);
}

export async function respondNightInvite(
  nightId: string,
  accept: boolean,
): Promise<void> {
  const { error } = await createSupabaseServerClient().rpc(
    "respond_night_invite",
    { p_night: nightId, p_accept: accept },
  );
  if (error) fail(error);
}

export async function leaveNight(nightId: string): Promise<void> {
  const { error } = await createSupabaseServerClient().rpc("leave_night", {
    p_night: nightId,
  });
  if (error) fail(error);
}

export async function suggestNightGame(
  nightId: string,
  gameId: string,
): Promise<void> {
  const { error } = await createSupabaseServerClient().rpc(
    "suggest_night_game",
    { p_night: nightId, p_game: gameId },
  );
  if (error) fail(error);
}

/** Returns whether the vote is now on. */
export async function toggleNightVote(nightGameId: string): Promise<boolean> {
  const { data, error } = await createSupabaseServerClient().rpc(
    "toggle_night_vote",
    { p_night_game: nightGameId },
  );
  if (error) fail(error);
  return data === true;
}

export async function listNightInvites(): Promise<NightInvite[]> {
  const { data, error } =
    await createSupabaseServerClient().rpc("night_invites");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    nightId: r.night_id,
    title: r.title,
    startsOn: r.starts_on,
    hostName: r.host_name,
  }));
}

/**
 * Creates the public link (revoking the previous one). The token exists only in this
 * result: the database keeps its sha256. Never log it.
 */
export async function createNightLink(
  nightId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await createSupabaseServerClient().rpc(
    "create_night_link",
    { p_night: nightId, p_token_hash: tokenHash },
  );
  if (error) fail(error);
  return { token, expiresAt: data };
}

export async function revokeNightLink(nightId: string): Promise<void> {
  const { error } = await createSupabaseServerClient().rpc(
    "revoke_night_link",
    { p_night: nightId },
  );
  if (error) fail(error);
}
