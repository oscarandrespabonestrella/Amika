"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { importGameAction } from "../actions/catalog-actions";

/** Adds a related game (an expansion) that is not in the catalog yet. */
export function ImportRelationButton({
  externalId,
  available,
}: {
  externalId: string;
  available: boolean;
}) {
  const t = useTranslations("Games");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!available) return null; // BGG token pending: nothing to offer yet

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await importGameAction(externalId);
      if (result.ok) router.push(`/games/${result.gameId}`);
      else setError(result.error);
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
