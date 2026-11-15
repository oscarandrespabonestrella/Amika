type MetaT = (
  key: "players" | "playersRange" | "minutes" | "minutesRange",
  values: Record<string, number>,
) => string;

function range(
  min: number | null,
  max: number | null,
  one: (n: number) => string,
  many: (lo: number, hi: number) => string,
): string | null {
  if (min === null && max === null) return null;
  const lo = (min ?? max) as number;
  const hi = (max ?? min) as number;
  return lo === hi ? one(lo) : many(lo, hi);
}

export function formatPlayers(
  t: MetaT,
  min: number | null,
  max: number | null,
) {
  return range(
    min,
    max,
    (count) => t("players", { count }),
    (lo, hi) => t("playersRange", { min: lo, max: hi }),
  );
}

export function formatMinutes(
  t: MetaT,
  min: number | null,
  max: number | null,
) {
  return range(
    min,
    max,
    (count) => t("minutes", { count }),
    (lo, hi) => t("minutesRange", { min: lo, max: hi }),
  );
}
