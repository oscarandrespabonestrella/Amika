"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Friend } from "@/features/friends";
import { addFriendPlayerAction } from "../actions/player-actions";
import { PLAYER_NAME_MAX } from "../schemas";
import type { Player } from "../services/player-service";

type Notice =
  | { kind: "linked"; name: string }
  | { kind: "pending"; name: string }
  | {
      kind: "error";
      code: "exists" | "too_many" | "not_friend" | "invalid" | "failed";
    };

/**
 * Adds a friend to the roster (and, through `onAdded`, wherever the roster is being
 * used, e.g. a group). Friends already linked to a player are left out of the list.
 */
export function AddFriendPlayer({
  friends,
  players,
  onAdded,
  disabled = false,
}: {
  friends: Friend[];
  players: Player[];
  onAdded?: (playerId: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("AddFriendPlayer");
  const tf = useTranslations("Friends");
  const selectId = useId();
  const [pick, setPick] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, startTransition] = useTransition();

  const linkedIds = new Set(players.map((p) => p.friendId).filter(Boolean));
  const available = friends.filter((f) => !linkedIds.has(f.userId));
  if (friends.length === 0) return null;

  const nameOf = (f: Friend) =>
    (f.displayName.trim() || tf("unnamed")).slice(0, PLAYER_NAME_MAX);

  function add() {
    const friend = available.find((f) => f.userId === pick);
    if (!friend) return;
    const name = nameOf(friend);
    setNotice(null);
    startTransition(async () => {
      const result = await addFriendPlayerAction({
        friendId: friend.userId,
        name,
      });
      if (result.ok) {
        setPick("");
        setNotice({ kind: result.linked ? "linked" : "pending", name });
        onAdded?.(result.id);
      } else
        setNotice({
          kind: "error",
          code: result.error === "unauthenticated" ? "failed" : result.error,
        });
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
          <Label htmlFor={selectId}>{t("label")}</Label>
          <NativeSelect
            id={selectId}
            className="h-11"
            value={pick}
            disabled={available.length === 0}
            onChange={(event) => {
              setPick(event.target.value);
              setNotice(null);
            }}
          >
            <option value="">
              {available.length === 0 ? t("allAdded") : t("pick")}
            </option>
            {available.map((f) => (
              <option key={f.userId} value={f.userId}>
                {nameOf(f)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4"
          disabled={disabled || pending || !pick}
          onClick={add}
        >
          {t("add")}
        </Button>
      </div>
      <div aria-live="polite">
        {notice?.kind === "pending" && (
          <p className="text-sm text-muted-foreground">
            {t("pending", { name: notice.name })}
          </p>
        )}
        {notice?.kind === "linked" && (
          <p className="text-sm text-muted-foreground">
            {t("linked", { name: notice.name })}
          </p>
        )}
        {notice?.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${notice.code}`)}
          </p>
        )}
      </div>
    </div>
  );
}
