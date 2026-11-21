"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inviteToNightAction } from "../actions/night-actions";
import { toNightError, type NightErrorCode } from "../error-codes";

export type InviteFriend = { userId: string; name: string };
export type NightMember = { userId: string; name: string; status: string };

/** Host only: who is in the night and which friends can still be invited. */
export function InviteFriends({
  nightId,
  friends,
  members,
  disabled,
  onError,
  onDone,
}: {
  nightId: string;
  friends: InviteFriend[];
  members: NightMember[];
  disabled?: boolean;
  onError: (code: NightErrorCode | null) => void;
  onDone: () => void;
}) {
  const t = useTranslations("Nights.detail.invite");
  const td = useTranslations("Nights.detail");
  const unnamed = td("someone");
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Declined friends can be invited again; the others are already in.
  const inIds = new Set(
    members.filter((m) => m.status !== "declined").map((m) => m.userId),
  );
  const available = friends.filter((f) => !inIds.has(f.userId));

  function invite(friendId: string) {
    onError(null);
    setBusyId(friendId);
    startTransition(async () => {
      const result = await inviteToNightAction(nightId, friendId);
      if (result.ok) onDone();
      else onError(toNightError(result.error));
      setBusyId(null);
    });
  }

  return (
    <section aria-labelledby="invite-title" className="flex flex-col gap-3">
      <h2 id="invite-title" className="font-semibold">
        {t("title")}
      </h2>
      {members.length > 0 && (
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2"
            >
              <span className="min-w-0 truncate">{m.name || unnamed}</span>
              <Badge variant="secondary">
                {m.status === "accepted"
                  ? t("accepted")
                  : m.status === "declined"
                    ? t("declined")
                    : t("invited")}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {friends.length === 0 ? t("noFriends") : t("allInvited")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {available.map((f) => (
            <li
              key={f.userId}
              className="flex min-h-11 items-center justify-between gap-2"
            >
              <span className="min-w-0 truncate">{f.name || unnamed}</span>
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                disabled={disabled || pending}
                aria-busy={busyId === f.userId}
                aria-label={t("inviteName", { name: f.name || unnamed })}
                onClick={() => invite(f.userId)}
              >
                {t("action")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
