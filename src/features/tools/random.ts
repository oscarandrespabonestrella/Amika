// Pure randomness helpers shared by the table tools. The generator is injectable so
// the tests can be deterministic; the default is the browser's CSPRNG.

/** A source of numbers in [0, 1). */
export type Rng = () => number;

export const defaultRng: Rng = () => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
};

/** An integer in [0, max). */
export function randomInt(max: number, rng: Rng = defaultRng): number {
  return Math.floor(rng() * max);
}

/** A shuffled copy (Fisher–Yates). */
export function shuffle<T>(items: readonly T[], rng: Rng = defaultRng): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
