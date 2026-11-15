import { z } from "zod";

/** Wishlist is intentionally absent for now (product decision 2026-11-15). */
export const LIBRARY_STATUSES = ["owned", "previously_owned"] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export const libraryInputSchema = z
  .object({
    gameId: z.uuid(),
    status: z.enum(LIBRARY_STATUSES).optional(),
    isFavorite: z.boolean().optional(),
    rating: z.number().int().min(1).max(10).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export type LibraryInput = z.infer<typeof libraryInputSchema>;

// --- library page filters ------------------------------------------------------

export type LibraryFilters = {
  q: string;
  status?: LibraryStatus;
  favorites: boolean;
};

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** Tolerant: an invalid filter is dropped instead of failing the whole page. */
export function parseLibraryFilters(
  raw: Record<string, string | string[] | undefined>,
): LibraryFilters {
  const q = z
    .string()
    .trim()
    .max(100)
    .safeParse(first(raw.q) ?? "");
  const status = z.enum(LIBRARY_STATUSES).safeParse(first(raw.status));
  return {
    q: q.success ? q.data : "",
    status: status.success ? status.data : undefined,
    favorites: first(raw.favorites) === "1",
  };
}
