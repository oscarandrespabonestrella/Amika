import type { Category, CategoryType } from "./engine/definition";

const KEY_MAX = 30;

/**
 * A stable, unique category key from a label: ascii, [a-z0-9_], starts with a
 * letter, at most 30 characters (suffix included). The key is generated once
 * and never edited: stats and photo scoring rely on it staying put.
 */
export function slugifyKey(
  label: string,
  existingKeys: readonly string[],
): string {
  let base = label
    .slice(0, 200)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base === "") base = "category";
  if (!/^[a-z]/.test(base)) base = `c_${base}`;
  base = base.slice(0, KEY_MAX).replace(/_+$/, "");

  const taken = new Set(existingKeys);
  let key = base;
  for (let n = 2; taken.has(key); n++) {
    const suffix = `_${n}`;
    key = base.slice(0, KEY_MAX - suffix.length) + suffix;
  }
  return key;
}

/** A derived category computes from others, so it needs at least two to exist. */
export function canAddType(
  type: CategoryType,
  existingKeys: readonly string[],
): boolean {
  return type !== "derived" || existingKeys.length >= 2;
}

/** A valid category with neutral defaults for the given type. */
export function newCategory(
  type: CategoryType,
  label: string,
  existingKeys: readonly string[],
): Category {
  if (!canAddType(type, existingKeys))
    throw new Error("derived needs two existing categories");
  const base = {
    key: slugifyKey(label, existingKeys),
    label: label.trim().slice(0, 60),
    scoring: true,
  };
  switch (type) {
    case "number":
      return { ...base, type };
    case "count_times":
      return { ...base, type, pointsEach: 1 };
    case "per_n":
      return { ...base, type, n: 2, pointsPer: 1 };
    case "boolean":
      return { ...base, type, points: 1 };
    case "choice":
      return {
        ...base,
        type,
        options: [
          { key: "option_1", label: "1", points: 0 },
          { key: "option_2", label: "2", points: 1 },
        ],
      };
    case "table":
      return {
        ...base,
        type,
        rows: [
          { value: 0, points: 0 },
          { value: 1, points: 1 },
        ],
      };
    case "set_bonus":
      return {
        ...base,
        type,
        perSet: 0,
        inputs: [
          { key: "a", label: "A" },
          { key: "b", label: "B" },
        ],
      };
    case "derived":
      return { ...base, type, op: "sum", refs: existingKeys.slice(0, 2) };
  }
}

/**
 * Changes a category's label. A category that was never saved (its key is not in
 * `frozenKeys`) re-derives its key from the new label, and derived categories that
 * point at the old key follow it. Saved keys never change.
 */
export function relabelCategory(
  categories: readonly Category[],
  index: number,
  label: string,
  frozenKeys: ReadonlySet<string>,
): Category[] {
  const current = categories[index];
  if (!current) return [...categories];

  const otherKeys = categories.filter((_, i) => i !== index).map((c) => c.key);
  const key = frozenKeys.has(current.key)
    ? current.key
    : slugifyKey(label, otherKeys);

  return categories.map((category, i): Category => {
    if (i === index) return { ...category, key, label };
    if (category.type === "derived" && key !== current.key)
      return {
        ...category,
        refs: category.refs.map((ref) => (ref === current.key ? key : ref)),
      };
    return category;
  });
}

/** A copy of the list with one item moved by `delta`, clamped at the ends. */
export function moveItem<T>(
  list: readonly T[],
  index: number,
  delta: -1 | 1,
): T[] {
  const target = index + delta;
  const next = [...list];
  if (index < 0 || index >= list.length || target < 0 || target >= list.length)
    return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Sets (or clears) one counter of a `set_bonus` value, keeping only counters that
 * still exist on the sheet: a counter removed in the editor must not linger in the
 * preview values, where the engine would reject it as unknown.
 */
export function updateCounters(
  inputKeys: readonly string[],
  record: Readonly<Record<string, number>>,
  key: string,
  value: number | undefined,
): Record<string, number> | undefined {
  const next: Record<string, number> = {};
  for (const k of inputKeys) {
    if (k === key || !Object.hasOwn(record, k)) continue;
    next[k] = record[k];
  }
  if (value !== undefined) next[key] = value;
  return Object.keys(next).length > 0 ? next : undefined;
}
