"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  linkPlayerAction,
  unlinkPlayerAction,
} from "@/features/plays/actions/sharing-actions";
import { toFriendError } from "../error-codes";
import type { Friend } from "../services/friends-service";

type Props = {
  playerId: string;
  playerName: string;
  /** The friend this name is already linked to, if any. */
  friendId: string | null;
  friends: Friend[];
};

/**
 * Ties a name in my roster to a registered friend (who may have joined after the matches
 * were played). The friend confirms before anything changes.
 */
export function LinkFriend({ playerId, playerName, friendId, friends }: Props) {
  const t = useTranslations("LinkFriend");
  const te = useTranslations("Friends.errors");
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (friendId) {
    const friend = friends.find((f) => f.userId === friendId);
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{friend?.displayName ?? friendId}</Badge>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await unlinkPlayerAction(playerId);
              if (result.ok) router.refresh();
              else setError(result.error);
            })
          }
        >
          {t("unlink")}
        </Button>
        {error && <span role="alert">{te(toFriendError(error))}</span>}
      </div>
    );
  }
  if (friends.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <NativeSelect
        aria-label={t("label", { name: playerName })}
        value={pick}
        onChange={(e) => {
          setPick(e.target.value);
          setSent(false);
        }}
        data-testid="link-friend-select"
      >
        <option value="">{t("pick")}</option>
        {friends.map((f) => (
          <option key={f.userId} value={f.userId}>
            {f.displayName}
          </option>
        ))}
      </NativeSelect>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !pick}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await linkPlayerAction({
              playerId,
              friendId: pick,
            });
            if (result.ok) setSent(true);
            else setError(result.error);
          })
        }
      >
        {t("send")}
      </Button>
      {sent && <span role="status">{t("sent")}</span>}
      {error && (
        <span role="alert" className="text-destructive">
          {te(toFriendError(error))}
        </span>
      )}
    </div>
  );
}
