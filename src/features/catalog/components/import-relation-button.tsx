"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { importGameAction } from "../actions/catalog-actions";

/** Adds a related game (an expansion) that is not in the catalog yet. */
export function ImportRelationButton({
  externalId,
  gameId,
  available,
  onImported,
}: {
  externalId?: string;
  /** Already in the catalog: skip the import and only run `onImported`. */
  gameId?: string;
  available: boolean;
  /**
   * When given, the imported game is handed to it (e.g. to put it in the library as owned) and
   * the user stays on the page instead of being taken to the new game.
   */
  onImported?: (gameId: string) => Promise<{ ok: boolean }>;
}) {
  const t = useTranslations("Games");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!gameId && !available) return null; // BGG token pending: nothing to offer yet

  function add() {
    setError(null);
    startTransition(async () => {
      let id = gameId;
      if (!id) {
        const result = await importGameAction(externalId);
        if (!result.ok) return setError(result.error);
        id = result.gameId;
      }
      if (!onImported) return router.push(`/games/${id}`);
      const saved = await onImported(id);
      if (saved.ok) router.refresh();
      else setError("failed");
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9"
        disabled={pending}
        onClick={add}
      >
        {pending ? t("bgg.adding") : t("bgg.add")}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {t(`errors.${error as "failed"}`)}
        </span>
      )}
    </span>
  );
}
