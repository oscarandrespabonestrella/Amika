export const MAX_SECONDS = 99 * 3600 + 59 * 60 + 59;

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** Hours, minutes and seconds typed in separate boxes → total seconds (clamped). */
export function toSeconds(h: number, m: number, s: number): number {
  const total =
    (Math.max(0, h) || 0) * 3600 +
    (Math.max(0, m) || 0) * 60 +
    (Math.max(0, s) || 0);
  return Math.min(MAX_SECONDS, Math.trunc(total));
}

export function splitSeconds(total: number): {
  h: number;
  m: number;
  s: number;
} {
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}
