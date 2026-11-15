"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { deleteCustomGameAction } from "../actions/catalog-actions";

/** Edit / delete for the owner of a custom game (two-step delete, no accidental clicks). */
export function OwnerActions({ gameId }: { gameId: string }) {
  const t = useTranslations("Game.owner");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    setFailed(false);
    startTransition(async () => {
      const result = await deleteCustomGameAction(gameId);
      if (result.ok) router.push("/games");
      else setFailed(true);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/games/${gameId}/edit`}
          className={cn(buttonVariants({ variant: "outline" }), "h-10")}
        >
          <Pencil aria-hidden />
          {t("edit")}
        </Link>
        {!confirming ? (
          <Button
            type="button"
            variant="ghost"
            className="h-10"
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden />
            {t("delete")}
          </Button>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t("deleteConfirm")}
            </p>
            <Button
              type="button"
              variant="destructive"
              className="h-10"
              disabled={pending}
              onClick={remove}
            >
              {pending ? t("deleting") : t("deleteYes")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              {t("deleteNo")}
            </Button>
          </>
        )}
      </div>
      <div aria-live="polite">
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t("deleteError")}
          </p>
        )}
      </div>
    </div>
  );
}
