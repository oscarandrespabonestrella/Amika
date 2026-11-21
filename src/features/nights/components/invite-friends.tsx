"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inviteToNightAction } from "../actions/night-actions";
import { toNightError, type NightErrorCode } from "../error-codes";
import { SectionLabel } from "./choice-chips";

export type InviteFriend = { userId: string; name: string };
export type NightMember = { userId: string; name: string; status: string };

/** A round initial standing in for a person. */
function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-bold text-foreground"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** Host only: the guests (who is going) and which friends can still be invited. */
export function InviteFriends({
  nightId,
  hostName,
  friends,
  members,
  disabled,
  onError,
  onDone,
}: {
  nightId: string;
  hostName: string;
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
  const going = members.filter((m) => m.status === "accepted").length + 1;

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
    <section aria-labelledby="invite-title" className="flex flex-col gap-2.5">
      <SectionLabel id="invite-title">
        {t("title")} · {t("going", { count: going })}
      </SectionLabel>
      <ul className="flex flex-col">
        <li className="flex min-h-13 items-center gap-3 border-b border-border">
          <Initial name={hostName} />
          <span className="min-w-0 flex-1 truncate">
            {hostName}{" "}
            <span className="text-muted-foreground">({t("host")})</span>
          </span>
          <span className="text-sm text-primary">{t("accepted")}</span>
        </li>
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex min-h-13 items-center gap-3 border-b border-border"
          >
            <Initial name={m.name || unnamed} />
            <span className="min-w-0 flex-1 truncate">{m.name || unnamed}</span>
            <span
              className={cn(
                "text-sm",
                m.status === "accepted"
                  ? "text-primary"
                  : m.status === "declined"
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              {m.status === "accepted"
                ? t("accepted")
                : m.status === "declined"
                  ? t("declined")
                  : t("invited")}
            </span>
          </li>
        ))}
      </ul>
      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {friends.length === 0 ? t("noFriends") : t("allInvited")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {available.map((f) => (
            <li key={f.userId} className="flex min-h-13 items-center gap-3">
              <Initial name={f.name || unnamed} />
              <span className="min-w-0 flex-1 truncate">
                {f.name || unnamed}
              </span>
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
