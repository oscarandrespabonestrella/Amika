import "server-only";
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
import type { CreatePlayInput, UpdatePlayInput } from "../schemas";

export type PlaySummary = {
  id: string;
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
    name: string;
    manualTotal: number | null;
    values: Record<string, ScoreValue>;
  }[];
};

export type PlayOutcome =
  { playId: string } | "invalid" | "not_found" | "limit";

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
      "id, played_on, duration_minutes, scoring_sheet_versions(scoring_sheets(title)), play_participants(seat, total_score, rank, is_winner, players(name))",
    )
    .eq("game_id", gameId)
    .order("played_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    playedOn: row.played_on,
    durationMinutes: row.duration_minutes,
    sheetTitle: row.scoring_sheet_versions?.scoring_sheets?.title ?? null,
    participants: [...row.play_participants]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        name: p.players?.name ?? "",
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
      "id, game_id, played_on, duration_minutes, notes, scoring_version_id, scoring_sheet_versions(id, version, sheet_id, definition, scoring_sheets(title)), play_participants(seat, player_id, total_score, rank, is_winner, players(name), play_scores(category_key, value)), play_expansions(game_id)",
    )
    .eq("id", playId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  let sheet: PlayDetail["sheet"] = null;
  const version = data.scoring_sheet_versions;
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
    playedOn: data.played_on,
    durationMinutes: data.duration_minutes,
    notes: data.notes,
    sheetTitle: version?.scoring_sheets?.title ?? null,
    expansionIds: data.play_expansions.map((e) => e.game_id),
    sheet,
    participants: people.map((p) => ({
      name: p.players?.name ?? "",
      total: p.total_score,
      rank: p.rank,
      isWinner: p.is_winner,
    })),
    entries: people.map((p) => ({
      playerId: p.player_id,
      name: p.players?.name ?? "",
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
    const code = pgCode(error);
    if (code === "P0001") return "limit";
    if (code === "42501" || code === "23503" || code === "P0002")
      return "not_found";
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

export async function deletePlay(playId: string): Promise<void> {
  const { error } = await createSupabaseServerClient()
    .from("plays")
    .delete()
    .eq("id", playId);
  if (error) throw error;
}
