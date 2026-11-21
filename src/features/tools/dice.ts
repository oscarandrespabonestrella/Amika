import { clamp, defaultRng, randomInt, type Rng } from "./random";

export const DICE_TYPES = [4, 6, 8, 10, 12, 20] as const;
export const MIN_SIDES = 2;
export const MAX_SIDES = 100;
export const MIN_DICE = 1;
export const MAX_DICE = 8;
export const MAX_MODIFIER = 20;

export type DiceRoll = {
  values: number[];
  sides: number;
  modifier: number;
  /** Sum of the dice plus the modifier. */
  total: number;
};

/** Rolls `count` dice of `sides` faces; every input is clamped to the supported range. */
export function rollDice(
  count: number,
  sides: number,
  modifier: number,
  rng: Rng = defaultRng,
): DiceRoll {
  const n = clamp(Math.trunc(count) || MIN_DICE, MIN_DICE, MAX_DICE);
  const s = clamp(Math.trunc(sides) || MIN_SIDES, MIN_SIDES, MAX_SIDES);
  const m = clamp(Math.trunc(modifier) || 0, -MAX_MODIFIER, MAX_MODIFIER);
  const values = Array.from({ length: n }, () => 1 + randomInt(s, rng));
  return {
    values,
    sides: s,
    modifier: m,
    total: values.reduce((sum, v) => sum + v, 0) + m,
  };
}

/** "2d6+3", "1d20", "3d8-1". */
export function formatFormula(
  count: number,
  sides: number,
  modifier: number,
): string {
  const mod =
    modifier === 0 ? "" : modifier > 0 ? `+${modifier}` : `${modifier}`;
  return `${count}d${sides}${mod}`;
}
