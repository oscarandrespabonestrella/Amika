"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toFriendError } from "../error-codes";
import { useRouter } from "@/i18n/navigation";
import { redeemFriendInviteAction } from "../actions/friend-actions";

/**
 * Opening the link does NOT make the friendship: redeeming is a click, so a link preview or a
 * prefetch cannot consume it.
 */
export function JoinFriend({ code }: { code: string }) {
  const t = useTranslations("Friends.join");
  const te = useTranslations("Friends.errors");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done)
    return (
      <p role="status" className="font-medium">
        {t("done")}
      </p>
    );

  return (
    <div className="flex flex-col items-start gap-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {te(toFriendError(error))}
        </p>
      )}
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await redeemFriendInviteAction(code);
            if (result.ok) {
              setDone(true);
              router.push("/friends");
            } else setError(result.error);
          })
        }
      >
        {t("accept")}
      </Button>
    </div>
  );
}
