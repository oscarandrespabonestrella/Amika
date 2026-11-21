import { defaultRng, randomInt, shuffle, type Rng } from "./random";

export const RANGE_LIMIT = 9999;
const SMALL_RANGE = 5000;

export type RangeCheck = "ok" | "empty" | "too_small";

/** Whether `count` numbers can be drawn from [min, max] (unique numbers need room). */
export function checkRange(
  count: number,
  min: number,
  max: number,
  unique: boolean,
): RangeCheck {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    return "empty";
  }
  if (unique && max - min + 1 < count) return "too_small";
  return "ok";
}

/** One secret number per player; `null` when the range is invalid (see `checkRange`). */
export function drawNumbers(
  count: number,
  min: number,
  max: number,
  unique: boolean,
  rng: Rng = defaultRng,
): number[] | null {
  if (checkRange(count, min, max, unique) !== "ok") return null;
  const size = max - min + 1;
  if (!unique) {
    return Array.from({ length: count }, () => min + randomInt(size, rng));
  }
  if (size <= SMALL_RANGE) {
    return shuffle(
      Array.from({ length: size }, (_, i) => min + i),
      rng,
    ).slice(0, count);
  }
  // A big range and a handful of players: drawing until all differ is fast.
  const picked = new Set<number>();
  while (picked.size < count) picked.add(min + randomInt(size, rng));
  return [...picked];
}
