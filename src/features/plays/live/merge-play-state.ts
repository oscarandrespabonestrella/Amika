// Pure: applies one Realtime change to the state of a live match. A DELETE (or anything it
// cannot place) asks for a fresh read instead of being trusted: Realtime's DELETE events
// are not filtered by RLS and carry little.

export type LiveParticipant = {
  id: string;
  seat: number;
  name: string;
  /** The account behind this seat; null for a loose name. */
  userId: string | null;
  scores: Record<string, unknown>;
  /** The stored total: null until the owner closes the match. */
  total: number | null;
};

export type LivePlay = {
  id: string;
  status: "open" | "closed";
  participants: LiveParticipant[];
  members: { userId: string; status: string }[];
};

export type LiveChange = {
  table: "plays" | "play_participants" | "play_scores" | "play_members";
  type: "INSERT" | "UPDATE" | "DELETE";
  row: Record<string, unknown>;
};

const bySeat = (a: LiveParticipant, b: LiveParticipant) => a.seat - b.seat;

export function applyChange(
  state: LivePlay,
  change: LiveChange,
): LivePlay | "refetch" {
  const { table, type, row } = change;
  const rowOfThisPlay =
    table === "plays" ? row.id === state.id : row.play_id === state.id;

  if (type === "DELETE") return "refetch";

  if (table === "play_scores") {
    const owner = state.participants.find((p) => p.id === row.participant_id);
    if (!owner) return "refetch"; // a participant we do not know yet
    return {
      ...state,
      participants: state.participants.map((p) =>
        p === owner
          ? {
              ...p,
              scores: { ...p.scores, [String(row.category_key)]: row.value },
            }
          : p,
      ),
    };
  }

  if (!rowOfThisPlay) return state;

  if (table === "plays")
    return { ...state, status: row.status === "open" ? "open" : "closed" };

  if (table === "play_members") {
    const userId = String(row.user_id);
    const rest = state.members.filter((m) => m.userId !== userId);
    return {
      ...state,
      members: [...rest, { userId, status: String(row.status) }],
    };
  }

  // play_participants
  const next: LiveParticipant = {
    id: String(row.id),
    seat: Number(row.seat),
    name: String(row.display_name),
    userId: (row.user_id as string | null) ?? null,
    scores: state.participants.find((p) => p.id === row.id)?.scores ?? {},
    total: (row.total_score as number | null) ?? null,
  };
  const exists = state.participants.some((p) => p.id === next.id);
  return {
    ...state,
    participants: (exists
      ? state.participants.map((p) => (p.id === next.id ? next : p))
      : [...state.participants, next]
    ).sort(bySeat),
  };
}

/**
 * What to show as a total: the stored one once the match is closed, the provisional one
 * (computed in the browser, for display only) while it is open. The provisional value never
 * replaces a stored total, and is not invented for a closed match with nothing scored.
 */
export function shownTotal(
  play: LivePlay,
  participant: LiveParticipant,
  provisional: number | null,
): number | null {
  return play.status === "closed" ? participant.total : provisional;
}
