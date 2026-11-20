"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

const KEY = "games-search";

/**
 * Remembers the catalog search (text + filters) for this tab. Entering /games with no
 * criteria restores the last one; the "clear" link goes to `?q=` so it is not undone.
 * The state itself stays in the URL, so back/forward keeps working without this.
 */
export function SearchMemory() {
  const params = useSearchParams();
  const router = useRouter();
  const qs = params.toString();
  const hasCriteria = [...params.values()].some((v) => v.trim() !== "");

  useEffect(() => {
    try {
      if (qs) {
        if (hasCriteria) sessionStorage.setItem(KEY, qs);
        else sessionStorage.removeItem(KEY);
        return;
      }
      const saved = sessionStorage.getItem(KEY);
      if (saved) router.replace(`/games?${saved}`);
    } catch {
      // Storage unavailable (private mode…): the search just isn't remembered.
    }
  }, [qs, hasCriteria, router]);

  return null;
}
