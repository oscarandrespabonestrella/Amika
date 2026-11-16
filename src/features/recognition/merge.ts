// Pure: no imports. Combines what each technique found into one ranked list.

export type Reason = "code" | "title" | "image";

export type Signal = {
  reason: Reason;
  /** Catalog id when the game is already in our catalog. */
  gameId: string | null;
  /** External (BGG) id when it is not. */
  externalId: string | null;
  name: string;
  /** 0–1: how strong this one technique thinks the match is. */
  strength: number;
};

export type Candidate = {
  gameId: string | null;
  externalId: string | null;
  name: string;
  /** 0–1, never "certain": the user always confirms. */
  score: number;
  reasons: Reason[];
};

const WEIGHT: Record<Reason, number> = { code: 0.95, title: 0.7, image: 0.35 };
const ORDER: Reason[] = ["code", "title", "image"];

export function mergeCandidates(signals: Signal[], limit = 5): Candidate[] {
  const groups = new Map<
    string,
    {
      gameId: string | null;
      externalId: string | null;
      name: string;
      best: Partial<Record<Reason, number>>;
    }
  >();
  for (const s of signals) {
    if (!(s.strength > 0)) continue;
    const key = s.gameId ?? `ext:${s.externalId ?? s.name}`;
    const g = groups.get(key) ?? {
      gameId: s.gameId,
      externalId: s.externalId,
      name: s.name,
      best: {},
    };
    g.gameId ??= s.gameId;
    g.externalId ??= s.externalId;
    g.best[s.reason] = Math.max(g.best[s.reason] ?? 0, Math.min(1, s.strength));
    groups.set(key, g);
  }

  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      candidate: {
        gameId: g.gameId,
        externalId: g.externalId,
        name: g.name,
        score: Math.min(
          1,
          ORDER.reduce((sum, r) => sum + WEIGHT[r] * (g.best[r] ?? 0), 0),
        ),
        reasons: ORDER.filter((r) => (g.best[r] ?? 0) > 0),
      } satisfies Candidate,
    }))
    .sort(
      (a, b) =>
        b.candidate.score - a.candidate.score ||
        a.candidate.name.localeCompare(b.candidate.name) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, limit)
    .map((x) => x.candidate);
}
