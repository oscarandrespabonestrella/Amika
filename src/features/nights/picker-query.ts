import { pickerQuerySchema, type PickerQuery } from "./schemas";

/** Reads the selector's filters from the URL; anything invalid is ignored. */
export function parsePickerQuery(
  raw: Record<string, string | string[] | undefined>,
): PickerQuery {
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const num = (v: string | string[] | undefined) => {
    const s = first(v);
    return s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined;
  };
  const parsed = pickerQuerySchema.safeParse({
    players: num(raw.players),
    maxMinutes: num(raw.maxMinutes),
    groupId: first(raw.groupId),
  });
  if (parsed.success) return parsed.data;
  // One bad value should not drop the valid ones.
  const out: PickerQuery = {};
  for (const key of ["players", "maxMinutes", "groupId"] as const) {
    const single = pickerQuerySchema.safeParse({
      [key]: key === "groupId" ? first(raw[key]) : num(raw[key]),
    });
    if (single.success && single.data[key] !== undefined) {
      Object.assign(out, { [key]: single.data[key] });
    }
  }
  return out;
}

/**
 * Today as `YYYY-MM-DD` (UTC). Only used server-side for ranking, where being
 * off by a day near midnight is acceptable; the night date default is the
 * viewer's local date (see night-picker).
 */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
