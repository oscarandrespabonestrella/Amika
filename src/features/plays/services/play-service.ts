import "server-only";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Definition } from "@/features/scoring/engine/definition";
import type { ScoreValue } from "@/features/scoring/engine/evaluate";
import { validateDefinition } from "@/features/scoring/engine/validate";
import { pickDefaultSheet, type RankedSheet } from "@/features/scoring/ranking";
import { getSheet } from "@/features/scoring/services/sheet-service";
import { computePlay, type ParticipantInput } from "../compute";
import { mapSavePlayError } from "../save-errors";
import type { CreatePlayInput, UpdatePlayInput } from "../schemas";

export type PlaySummary = {
  id: string;
  /** 'open' = a live match; false `mine` = shared with me by another owner. */
  status: "open" | "closed";
  mine: boolean;
  playedOn: string;
  durationMinutes: number | null;
  sheetTitle: string | null;
  participants: {
    name: string;
    total: number | null;
    rank: number | null;
    isWinner: boolean;
  }[];
};

export type PlayDetail = PlaySummary & {
  gameId: string;
  ownerId: string;
  /** 'open': the members write their own column; 'closed': final. */
  status: "open" | "closed";
  notes: string | null;
  expansionIds: string[];
  /** The sheet version the match was scored with; null = manual totals. */
  sheet: {
    sheetId: string;
    versionId: string;
    version: number;
    definition: Definition;
  } | null;
  /** What was entered, per player in seat order (to prefill the form). */
  entries: {
    playerId: string;
    /** The account behind this player in a shared match; null for a loose name. */
    userId: string | null;
    name: string;
    manualTotal: number | null;
    values: Record<string, ScoreValue>;
  }[];
};

export type PlayOutcome =
  | { playId: string }
  | "invalid"
  | "not_found"
  | "limit"
  | "players_limit"
  | "duplicate_player";

/** Postgres codes: 42501 = RLS said no, 23503 = missing parent, P0001 = a limit, P0002 = no such match. */
const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

const PLAYS_LIST_LIMIT = 20;

/** RLS: only the signed-in user's own matches. Newest first. */
export async function listPlaysForGame(
  gameId: string,
  limit = PLAYS_LIST_LIMIT,
): Promise<PlaySummary[]> {
  if (!z.uuid().safeParse(gameId).success) return [];
  const { data, error } = await createSupabaseServerClient()
    .from("plays")
    .select(
      "id, status, owner_id, played_on, duration_minutes, scoring_sheet_versions(scoring_sheets(title)), play_participants(seat, display_name, total_score, rank, is_winner)",
    )
    .eq("game_id", gameId)
    .order("played_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const { userId } = await auth();
  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status as "open" | "closed",
    mine: row.owner_id === userId,
    playedOn: row.played_on,
    durationMinutes: row.duration_minutes,
    sheetTitle: row.scoring_sheet_versions?.scoring_sheets?.title ?? null,
    participants: [...row.play_participants]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        name: p.display_name,
        total: p.total_score,
        rank: p.rank,
        isWinner: p.is_winner,
      })),
  }));
}

/**
 * One match with everything the form needs. Null when it is missing, not the
 * caller's, or when its stored sheet definition fails validation (it is untrusted).
 */
export async function getPlay(playId: string): Promise<PlayDetail | null> {
  if (!z.uuid().safeParse(playId).success) return null;
  const { data, error } = await createSupabaseServerClient()
    .from("plays")
    .select(
      "id, game_id, owner_id, status, played_on, duration_minutes, notes, scoring_version_id, scoring_sheet_versions(id, version, sheet_id, definition, scoring_sheets(title)), play_participants(seat, player_id, user_id, display_name, total_score, rank, is_winner, play_scores(category_key, value)), play_expansions(game_id)",
    )
    .eq("id", playId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  let sheet: PlayDetail["sheet"] = null;
  let version = data.scoring_sheet_versions;
  if (!version && data.scoring_version_id) {
    const { data: shared, error: sheetError } =
      await createSupabaseServerClient().rpc("play_sheet", { p_play: playId });
    if (sheetError) throw sheetError;
    const row = shared?.[0];
    if (row)
      version = {
        id: row.version_id,
        version: row.version,
        sheet_id: row.sheet_id,
        definition: row.definition,
        scoring_sheets: { title: row.title },
      };
  }
  if (version) {
    const validated = validateDefinition(version.definition);
    if (!validated.ok) {
      logger.error("plays.getPlay invalid stored definition", null, {
        playId,
        versionId: version.id,
      });
      return null;
    }
    sheet = {
      sheetId: version.sheet_id,
      versionId: version.id,
      version: version.version,
      definition: validated.definition,
    };
  }

  const people = [...data.play_participants].sort((a, b) => a.seat - b.seat);
  return {
    id: data.id,
    gameId: data.game_id,
    ownerId: data.owner_id ?? "",
    mine: data.owner_id === (await auth()).userId,
    status: data.status as "open" | "closed",
    playedOn: data.played_on,
    durationMinutes: data.duration_minutes,
    notes: data.notes,
    sheetTitle: version?.scoring_sheets?.title ?? null,
    expansionIds: data.play_expansions.map((e) => e.game_id),
    sheet,
    participants: people.map((p) => ({
      name: p.display_name,
      total: p.total_score,
      rank: p.rank,
      isWinner: p.is_winner,
    })),
    entries: people.map((p) => ({
      playerId: p.player_id,
      userId: p.user_id,
      name: p.display_name,
      manualTotal: sheet ? null : p.total_score,
      values: Object.fromEntries(
        p.play_scores.map((s) => [s.category_key, s.value as ScoreValue]),
      ),
    })),
  };
}

/**
 * The sheet to preselect for a new match, from the sheets on offer (ranking order): the
 * one used in the user's latest match of this game if it is still offered, else the
 * best-ranked community sheet, else their own most recent one (see pickDefaultSheet).
 */
export async function getPlayDefaults(
  gameId: string,
  options: readonly RankedSheet[],
): Promise<{ defaultSheetId: string | null }> {
  if (!z.uuid().safeParse(gameId).success) return { defaultSheetId: null };

  const { data: lastPlay, error } = await createSupabaseServerClient()
    .from("plays")
    .select("scoring_sheet_versions(sheet_id)")
    .eq("game_id", gameId)
    .not("scoring_version_id", "is", null)
    .order("played_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  return {
    defaultSheetId: pickDefaultSheet(
      options,
      lastPlay?.scoring_sheet_versions?.sheet_id ?? null,
    ),
  };
}

type Computed = ReturnType<typeof computePlay>;

/** The payload for `save_play`, built ONLY from the server's own computation. */
function toPayload(
  computed: Computed,
  playerIds: readonly (string | null)[],
  fields: {
    playId?: string;
    gameId: string;
    playedOn: string;
    durationMinutes: number | null;
    scoringVersionId: string | null;
    notes: string | null;
    expansionIds: string[];
    status?: "open" | "closed";
  },
): Json {
  return {
    ...fields,
    participants: computed.participants.map((p, i) => ({
      seat: p.seat,
      playerId: playerIds[i] ?? null,
      name: p.name,
      total: p.total,
      rank: p.rank,
      isWinner: p.isWinner,
      scores: p.scores,
    })),
  } as unknown as Json;
}

async function callSavePlay(payload: Json): Promise<PlayOutcome> {
  const { data, error } = await createSupabaseServerClient().rpc("save_play", {
    p: payload,
  });
  if (error) {
    const mapped = mapSavePlayError(
      pgCode(error),
      (error as { message?: string }).message,
    );
    if (mapped) return mapped;
    throw error;
  }
  return { playId: data };
}

export async function createPlay(input: CreatePlayInput): Promise<PlayOutcome> {
  let definition: Definition | null = null;
  let versionId: string | null = null;
  if (input.sheetId) {
    const sheet = await getSheet(input.sheetId);
    if (!sheet || sheet.gameId !== input.gameId) return "not_found";
    definition = sheet.definition;
    versionId = sheet.versionId;
  }

  const computed = computePlay(
    definition,
    input.participants as ParticipantInput[],
  );
  if (!computed.ok) return "invalid";

  return callSavePlay(
    toPayload(
      computed,
      input.participants.map((p) => p.playerId),
      {
        gameId: input.gameId,
        playedOn: input.playedOn,
        durationMinutes: input.durationMinutes,
        scoringVersionId: versionId,
        notes: input.notes,
        expansionIds: input.expansionIds,
        status: input.status,
      },
    ),
  );
}

/** The sheet (and game) of a match never change: the stored version is reused. */
export async function updatePlay(
  input: UpdatePlayInput,
): Promise<Exclude<PlayOutcome, "limit"> | "limit"> {
  const existing = await getPlay(input.playId);
  if (!existing) return "not_found";

  const computed = computePlay(
    existing.sheet?.definition ?? null,
    input.participants as ParticipantInput[],
  );
  if (!computed.ok) return "invalid";

  return callSavePlay(
    toPayload(
      computed,
      input.participants.map((p) => p.playerId),
      {
        playId: input.playId,
        gameId: existing.gameId,
        playedOn: input.playedOn,
        durationMinutes: input.durationMinutes,
        scoringVersionId: existing.sheet?.versionId ?? null,
        notes: input.notes,
        expansionIds: input.expansionIds,
      },
    ),
  );
}

/** The owner deletes: if other players remain the match passes to them (delete_play). */
export async function deletePlay(playId: string): Promise<void> {
  const { error } = await createSupabaseServerClient().rpc("delete_play", {
    p_play: playId,
  });
  if (error) throw error;
}
