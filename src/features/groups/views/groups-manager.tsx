"use client";

import { CircleAlert, Dices, Ellipsis, Plus, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Friend } from "@/features/friends";
import type { Player } from "@/features/players/client";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { deleteGroupAction, type GroupResult } from "../actions/group-actions";
import type { Group } from "../services/group-service";
import { Avatar, GroupSheet } from "./group-sheet";

type ErrorCode = Extract<GroupResult, { ok: false }>["error"];
type Sheet =
  | { kind: "create" }
  | { kind: "edit"; group: Group; focus: "name" | "members" };

/**
 * Groups as cards: who is in each, shortcuts to pick a game or log a match with them,
 * and a menu to edit, rename or delete. Creating and editing happen in a bottom sheet.
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
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteGroupAction(id);
      if (result.ok) setDeleting(null);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        type="button"
        className="h-11 w-fit gap-1.5 px-4"
        onClick={() => setSheet({ kind: "create" })}
      >
        <Plus className="size-4" strokeWidth={2.4} aria-hidden />
        {t("newGroup")}
      </Button>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {te(error)}
          </p>
        )}
      </div>

      <ul aria-label={t("listLabel")} className="flex flex-col gap-3">
        {groups.map((group) => (
          <li
            key={group.id}
            className="flex flex-col gap-3.5 rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h2 className="text-lg font-semibold break-words">
                  {group.name}
                </h2>
                <p className="text-sm break-words text-muted-foreground">
                  {group.members.length === 0
                    ? t("noMembers")
                    : `${group.members.map((m) => m.name).join(", ")} · ${t(
                        "members",
                        { count: group.members.length },
                      )}`}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={t("options", { name: group.name })}
                  className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Ellipsis className="size-5" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem
                    onSelect={() =>
                      setSheet({ kind: "edit", group, focus: "members" })
                    }
                  >
                    {t("editMembers")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      setSheet({ kind: "edit", group, focus: "name" })
                    }
                  >
                    {t("rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleting(group.id)}
                  >
                    {t("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {group.members.length > 0 && (
              <div className="flex items-center pl-2" aria-hidden>
                {group.members.slice(0, 6).map((m) => (
                  <Avatar
                    key={m.id}
                    name={m.name}
                    className="-ml-2 size-8 border-2 border-card text-xs"
                  />
                ))}
              </div>
            )}

            {group.members.length < 2 && (
              <div className="flex gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                <CircleAlert
                  className="mt-0.5 size-4.5 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden
                />
                <p className="text-sm">{t("tooFew")}</p>
              </div>
            )}

            {deleting === group.id ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("deleteConfirm", { name: group.name })}
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-11 px-4"
                  disabled={pending}
                  onClick={() => remove(group.id)}
                >
                  {t("deleteYes")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 px-4"
                  disabled={pending}
                  onClick={() => setDeleting(null)}
                >
                  {t("deleteNo")}
                </Button>
              </div>
            ) : group.members.length < 2 ? (
              <Button
                type="button"
                variant="secondary"
                className="h-11 gap-1.5 px-4"
                onClick={() =>
                  setSheet({ kind: "edit", group, focus: "members" })
                }
              >
                <UserPlus className="size-4" aria-hidden />
                {t("addPlayers")}
              </Button>
            ) : (
              <div className="flex gap-2">
                <Link
                  href={`/nights?groupId=${group.id}`}
                  aria-label={t("pickGameFor", { name: group.name })}
                  className={cn(buttonVariants(), "h-11 flex-1 gap-1.5 px-3")}
                >
                  <Dices className="size-4" aria-hidden />
                  {t("pickGame")}
                </Link>
                <Link
                  href={`/log?group=${group.id}`}
                  aria-label={t("logMatchFor", { name: group.name })}
                  className={cn(
                    buttonVariants({ variant: "secondary" }),
                    "h-11 flex-1 gap-1.5 px-3",
                  )}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("logMatch")}
                </Link>
              </div>
            )}
          </li>
        ))}
      </ul>

      {sheet && (
        <GroupSheet
          key={sheet.kind === "edit" ? sheet.group.id : "new"}
          group={sheet.kind === "edit" ? sheet.group : null}
          focus={sheet.kind === "edit" ? sheet.focus : "name"}
          players={players}
          friends={friends}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
