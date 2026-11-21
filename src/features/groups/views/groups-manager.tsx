"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Friend } from "@/features/friends";
import { addPlayerAction } from "@/features/players/actions/player-actions";
import {
  normalizePlayerName,
  PLAYER_NAME_MAX,
  type Player,
} from "@/features/players/client";
import { AddFriendPlayer } from "@/features/players/components/add-friend-player";
import {
  createGroupAction,
  deleteGroupAction,
  renameGroupAction,
  setGroupMembersAction,
  type GroupResult,
} from "../actions/group-actions";
import { GROUP_NAME_MAX } from "../schemas";
import type { Group } from "../services/group-service";

type ErrorCode =
  | Extract<GroupResult, { ok: false }>["error"]
  | "playerExists"
  | "playersFull";
type Mode =
  | { kind: "rename"; id: string; name: string }
  | {
      kind: "members";
      id: string;
      selected: ReadonlySet<string>;
      /** A new player's name, typed while choosing (the roster may be empty). */
      draft: string;
    }
  | { kind: "delete"; id: string };

/**
 * Groups: create, rename, choose members from the roster (or add a new player right
 * there), delete (players are kept). A new group opens straight on its players.
 */
export function GroupsManager({
  groups,
  players,
  friends = [],
}: {
  groups: Group[];
  players: Player[];
  friends?: Friend[];
}) {
  const t = useTranslations("Groups");
  const te = useTranslations("Groups.errors");
  const [newName, setNewName] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    call: () => Promise<GroupResult>,
    then?: (result: GroupResult & { ok: true }) => void,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        setMode(null);
        then?.(result);
      } else setError(result.error);
    });
  }

  /** Selects the typed player, adding it to the roster first when it is new. */
  function addMember(here: Extract<Mode, { kind: "members" }>) {
    const name = here.draft.trim();
    if (name === "") return;
    setError(null);
    const known = players.find(
      (p) => normalizePlayerName(p.name) === normalizePlayerName(name),
    );
    if (known) {
      setMode({
        ...here,
        draft: "",
        selected: new Set(here.selected).add(known.id),
      });
      return;
    }
    startTransition(async () => {
      const result = await addPlayerAction({ name });
      if (result.ok) {
        setMode({
          ...here,
          draft: "",
          selected: new Set(here.selected).add(result.id),
        });
      } else
        setError(
          result.error === "exists"
            ? "playerExists"
            : result.error === "too_many"
              ? "playersFull"
              : result.error,
        );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => createGroupAction({ name: newName }),
            (result) => {
              setNewName("");
              if (result.id)
                setMode({
                  kind: "members",
                  id: result.id,
                  selected: new Set(),
                  draft: "",
                });
            },
          );
        }}
      >
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
          <Label htmlFor="new-group">{t("newLabel")}</Label>
          <Input
            id="new-group"
            className="h-11"
            value={newName}
            maxLength={GROUP_NAME_MAX}
            placeholder={t("newPlaceholder")}
            onChange={(event) => setNewName(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          className="h-11 px-4"
          disabled={pending || newName.trim() === ""}
        >
          {t("create")}
        </Button>
      </form>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {te(error)}
          </p>
        )}
      </div>

      <ul aria-label={t("listLabel")} className="flex flex-col gap-3">
        {groups.map((group) => {
          const here = mode && mode.id === group.id ? mode : null;
          return (
            <li
              key={group.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 text-base font-semibold break-words">
                  {group.name}
                </span>
                <Badge variant="outline">
                  {t("members", { count: group.members.length })}
                </Badge>
              </div>
              {here?.kind !== "members" && (
                <p className="text-sm break-words text-muted-foreground">
                  {group.members.length === 0
                    ? t("noMembers")
                    : group.members.map((m) => m.name).join(", ")}
                </p>
              )}

              {here?.kind === "rename" && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
                    <Label htmlFor={`rename-${group.id}`}>
                      {t("renameLabel", { name: group.name })}
                    </Label>
                    <Input
                      id={`rename-${group.id}`}
                      className="h-11"
                      value={here.name}
                      maxLength={GROUP_NAME_MAX}
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
                        renameGroupAction({
                          groupId: group.id,
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

              {here?.kind === "members" && (
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-2 text-sm font-medium">
                    {t("membersLegend", { name: group.name })}
                  </legend>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {players.map((player) => (
                      <li key={player.id}>
                        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm">
                          <input
                            type="checkbox"
                            className="size-5"
                            checked={here.selected.has(player.id)}
                            onChange={(event) => {
                              const next = new Set(here.selected);
                              if (event.target.checked) next.add(player.id);
                              else next.delete(player.id);
                              setMode({ ...here, selected: next });
                            }}
                          />
                          <span className="min-w-0 break-words">
                            {player.name}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {players.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("noRoster")}
                    </p>
                  )}
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
                      <Label htmlFor={`add-player-${group.id}`}>
                        {t("addPlayerLabel")}
                      </Label>
                      <Input
                        id={`add-player-${group.id}`}
                        className="h-11"
                        value={here.draft}
                        maxLength={PLAYER_NAME_MAX}
                        placeholder={t("addPlayerPlaceholder")}
                        onChange={(event) =>
                          setMode({ ...here, draft: event.target.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addMember(here);
                          }
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 px-4"
                      disabled={pending || here.draft.trim() === ""}
                      onClick={() => addMember(here)}
                    >
                      {t("addPlayer")}
                    </Button>
                  </div>
                  <AddFriendPlayer
                    friends={friends}
                    players={players}
                    disabled={pending}
                    onAdded={(playerId) =>
                      setMode((m) =>
                        m?.kind === "members" && m.id === group.id
                          ? { ...m, selected: new Set(m.selected).add(playerId) }
                          : m,
                      )
                    }
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      className="h-11 px-4"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          setGroupMembersAction({
                            groupId: group.id,
                            playerIds: [...here.selected],
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
                </fieldset>
              )}

              {here?.kind === "delete" && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    {t("deleteConfirm", { name: group.name })}
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() => run(() => deleteGroupAction(group.id))}
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
                        kind: "members",
                        id: group.id,
                        selected: new Set(group.members.map((m) => m.id)),
                        draft: "",
                      })
                    }
                  >
                    {t("editMembers")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() =>
                      setMode({
                        kind: "rename",
                        id: group.id,
                        name: group.name,
                      })
                    }
                  >
                    {t("rename")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() => setMode({ kind: "delete", id: group.id })}
                  >
                    {t("delete")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
