"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkFriend } from "@/features/friends/components/link-friend";
import type { Friend } from "@/features/friends";
import { NativeSelect } from "@/components/ui/native-select";
import {
  deletePlayerAction,
  mergePlayersAction,
  renamePlayerAction,
  setMeAction,
  type PlayerResult,
} from "../actions/player-actions";
import { PLAYER_NAME_MAX } from "../schemas";
import type { Player } from "../services/player-service";

type ErrorCode = Extract<PlayerResult, { ok: false }>["error"];
type Mode =
  | { kind: "rename"; id: string; name: string }
  | { kind: "merge"; id: string; targetId: string }
  | { kind: "delete"; id: string };

/** The roster: rename, merge into another player, delete when unused, mark "me". */
export function PlayersManager({
  players,
  friends = [],
}: {
  players: Player[];
  friends?: Friend[];
}) {
  const t = useTranslations("Players");
  const te = useTranslations("Players.errors");
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function run(call: () => Promise<PlayerResult>) {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (result.ok) setMode(null);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={t("listLabel")} className="flex flex-col gap-3">
        {players.map((player) => {
          const others = players.filter((p) => p.id !== player.id);
          const here = mode && mode.id === player.id ? mode : null;
          return (
            <li
              key={player.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 text-base font-semibold break-words">
                  {player.name}
                </span>
                {player.isMe && <Badge>{t("me")}</Badge>}
                <Badge variant="outline">
                  {t("matches", { count: player.matchCount })}
                </Badge>
              </div>
              {!player.isMe && (
                <LinkFriend
                  playerId={player.id}
                  playerName={player.name}
                  friendId={player.friendId}
                  friends={friends}
                />
              )}

              {here?.kind === "rename" && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
                    <Label htmlFor={`rename-${player.id}`}>
                      {t("renameLabel", { name: player.name })}
                    </Label>
                    <Input
                      id={`rename-${player.id}`}
                      className="h-11"
                      value={here.name}
                      maxLength={PLAYER_NAME_MAX}
                      onChange={(event) =>
                        setMode({ ...here, name: event.target.value })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    className="h-11 px-4"
                    disabled={pending || here.name.trim() === ""}
                    onClick={() =>
                      run(() =>
                        renamePlayerAction({
                          playerId: player.id,
                          name: here.name,
                        }),
                      )
                    }
                  >
                    {t("save")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() => setMode(null)}
                  >
                    {t("cancel")}
                  </Button>
                </div>
              )}

              {here?.kind === "merge" && (
                <div className="flex flex-col gap-3">
                  <div className="flex max-w-sm flex-col gap-1.5">
                    <Label htmlFor={`merge-${player.id}`}>
                      {t("mergeLabel", { name: player.name })}
                    </Label>
                    <NativeSelect
                      id={`merge-${player.id}`}
                      className="h-11"
                      value={here.targetId}
                      onChange={(event) =>
                        setMode({ ...here, targetId: event.target.value })
                      }
                    >
                      <option value="">{t("mergePick")}</option>
                      {others.map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("mergeConfirm", { name: player.name })}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      className="h-11 px-4"
                      disabled={pending || here.targetId === ""}
                      onClick={() =>
                        run(() =>
                          mergePlayersAction({
                            keepId: here.targetId,
                            removeId: player.id,
                          }),
                        )
                      }
                    >
                      {t("mergeYes")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 px-4"
                      disabled={pending}
                      onClick={() => setMode(null)}
                    >
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              )}

              {here?.kind === "delete" && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    {t("deleteConfirm", { name: player.name })}
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() => run(() => deletePlayerAction(player.id))}
                  >
                    {t("deleteYes")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() => setMode(null)}
                  >
                    {t("deleteNo")}
                  </Button>
                </div>
              )}

              {!here && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() =>
                      setMode({
                        kind: "rename",
                        id: player.id,
                        name: player.name,
                      })
                    }
                  >
                    {t("rename")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={pending || others.length === 0}
                    onClick={() =>
                      setMode({ kind: "merge", id: player.id, targetId: "" })
                    }
                  >
                    {t("merge")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        setMeAction({
                          playerId: player.isMe ? null : player.id,
                        }),
                      )
                    }
                  >
                    {player.isMe ? t("unmarkMe") : t("markMe")}
                  </Button>
                  {player.matchCount > 0 ? (
                    <span className="text-sm text-muted-foreground">
                      {t("deleteBlocked")}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 px-4"
                      disabled={pending}
                      onClick={() => setMode({ kind: "delete", id: player.id })}
                    >
                      {t("delete")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {te(error)}
          </p>
        )}
      </div>
    </div>
  );
}
