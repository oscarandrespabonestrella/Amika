"use client";

import { Check, Search, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Friend } from "@/features/friends";
import {
  addFriendPlayerAction,
  addPlayerAction,
  ensureMePlayerAction,
} from "@/features/players/actions/player-actions";
import {
  normalizePlayerName,
  PLAYER_NAME_MAX,
  type Player,
} from "@/features/players/client";
import { cn } from "@/lib/utils";
import {
  createGroupAction,
  renameGroupAction,
  setGroupMembersAction,
  type GroupResult,
} from "../actions/group-actions";
import { GROUP_NAME_MAX } from "../schemas";
import type { Group } from "../services/group-service";

type ErrorCode =
  | Extract<GroupResult, { ok: false }>["error"]
  | "playerExists"
  | "playersFull"
  | "notFriend";

/** The fewest players a new group needs (an existing one may drop below, with a warning). */
const MIN_NEW = 2;

const AVATAR_COLORS = [
  "#7C9CFF",
  "#F2B544",
  "#5ED3B5",
  "#E39AC4",
  "#9BD27A",
  "#E8A33B",
];

/** A person's initial on a colour picked from their name (dark text on light colours). */
export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full font-bold text-[#0B0F14]",
        className,
      )}
      style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** The row standing for the user when no player is marked "This is me" yet. */
const ME_NEW = "me:new";

type Row = {
  /** A player id, `friend:<userId>` for a friend not yet in the roster, or ME_NEW. */
  key: string;
  name: string;
  tag: "me" | "friend" | null;
  /** A friend to link this player to when saving (same name, not linked yet). */
  linkFriend?: string;
};

/**
 * Bottom sheet to create a group or edit one: its name and who plays. The list holds
 * the roster plus friends not yet in it (checking one adds them as a player and asks
 * them to confirm the link); typing a new name adds a player right there.
 */
export function GroupSheet({
  group,
  focus,
  players,
  friends,
  myName,
  onClose,
}: {
  group: Group | null;
  focus: "name" | "members";
  players: Player[];
  friends: Friend[];
  /** The user's profile name, for their own player when none is marked yet. */
  myName: string;
  onClose: () => void;
}) {
  const t = useTranslations("Groups");
  const te = useTranslations("Groups.errors");
  const tf = useTranslations("Friends");
  const [name, setName] = useState(group?.name ?? "");
  const mePlayer = players.find((p) => p.isMe);
  // A new group always starts with the user in it.
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        group
          ? group.members.map((m) => m.id)
          : [mePlayer ? mePlayer.id : ME_NEW],
      ),
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const linked = new Set(players.map((p) => p.friendId).filter(Boolean));
  const friendName = (f: Friend) =>
    (f.displayName.trim() || tf("unnamed")).slice(0, PLAYER_NAME_MAX);
  // A friend whose name is exactly an unlinked player's is that player, not a second row.
  const friendByName = new Map<string, Friend>();
  for (const f of friends)
    if (!linked.has(f.userId))
      friendByName.set(normalizePlayerName(friendName(f)), f);
  const merged = new Set<string>();
  const rows: Row[] = [
    ...(mePlayer
      ? [{ key: mePlayer.id, name: mePlayer.name, tag: "me" as const }]
      : [
          {
            key: ME_NEW,
            name: (myName.trim() || t("meFallback")).slice(0, PLAYER_NAME_MAX),
            tag: "me" as const,
          },
        ]),
    ...players
      .filter((p) => !p.isMe)
      .map((p): Row => {
        if (p.friendId) return { key: p.id, name: p.name, tag: "friend" };
        const friend = friendByName.get(normalizePlayerName(p.name));
        if (!friend || merged.has(friend.userId))
          return { key: p.id, name: p.name, tag: null };
        merged.add(friend.userId);
        return {
          key: p.id,
          name: p.name,
          tag: "friend",
          linkFriend: friend.userId,
        };
      }),
    ...friends
      .filter((f) => !linked.has(f.userId) && !merged.has(f.userId))
      .map((f) => ({
        key: `friend:${f.userId}`,
        name: friendName(f),
        tag: "friend" as const,
      })),
  ];
  const query = normalizePlayerName(draft);
  const shown = query
    ? rows.filter((r) => normalizePlayerName(r.name).includes(query))
    : rows;
  const exact = rows.find((r) => normalizePlayerName(r.name) === query);
  const count = selected.size;
  const isNew = group === null;
  const noName = name.trim() === "";
  const tooFew = isNew && count < MIN_NEW;
  const blocked = noName || tooFew;

  function toggle(key: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function addTyped() {
    const typed = draft.trim();
    if (typed === "") return;
    if (exact) {
      toggle(exact.key, true);
      setDraft("");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addPlayerAction({ name: typed });
      if (result.ok) {
        toggle(result.id, true);
        setDraft("");
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

  function save() {
    if (blocked) return;
    setError(null);
    startTransition(async () => {
      let groupId = group?.id;
      if (!groupId) {
        const created = await createGroupAction({ name });
        if (!created.ok || !created.id) {
          setError(created.ok ? "failed" : created.error);
          return;
        }
        groupId = created.id;
      } else if (name.trim() !== group?.name) {
        const renamed = await renameGroupAction({ groupId, name });
        if (!renamed.ok) {
          setError(renamed.error);
          return;
        }
      }

      const playerIds: string[] = [];
      for (const key of selected) {
        if (key === ME_NEW) {
          const me = await ensureMePlayerAction({
            name: rows.find((r) => r.key === ME_NEW)?.name ?? "",
          });
          if (!me.ok) {
            setError(
              me.error === "exists"
                ? "playerExists"
                : me.error === "too_many"
                  ? "playersFull"
                  : me.error,
            );
            return;
          }
          playerIds.push(me.id);
          continue;
        }
        const row = rows.find((r) => r.key === key);
        const friendId = key.startsWith("friend:")
          ? key.slice("friend:".length)
          : row?.linkFriend;
        if (!friendId) {
          playerIds.push(key);
          continue;
        }
        // Reuses the same-name player and asks the friend to confirm the link.
        const added = await addFriendPlayerAction({
          friendId,
          name: row?.name ?? "",
        });
        if (!added.ok) {
          setError(
            added.error === "exists"
              ? "playerExists"
              : added.error === "too_many"
                ? "playersFull"
                : added.error === "not_friend"
                  ? "notFriend"
                  : added.error,
          );
          return;
        }
        playerIds.push(added.id);
      }
      const saved = await setGroupMembersAction({ groupId, playerIds });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full max-w-lg gap-0 rounded-t-3xl border-x"
      >
        <div
          aria-hidden
          className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted-foreground/40"
        />
        <SheetHeader className="px-5 pt-2 pb-0">
          <SheetTitle className="text-xl">
            {isNew ? t("newTitle") : t("editTitle", { name: group.name })}
          </SheetTitle>
          <SheetDescription>{t("sheetHint")}</SheetDescription>
        </SheetHeader>

        <form
          id="group-sheet-form"
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-name">{t("nameLabel")}</Label>
            <Input
              id="group-name"
              className="h-12"
              value={name}
              maxLength={GROUP_NAME_MAX}
              placeholder={t("newPlaceholder")}
              autoFocus={focus === "name"}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <legend className="text-sm font-medium">
                {t("membersLegendShort")}
              </legend>
              <span
                className="text-sm text-muted-foreground"
                aria-live="polite"
              >
                {t("selected", { count })}
              </span>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-input bg-card px-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
              <Search
                className="size-4.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <label htmlFor="group-search" className="sr-only">
                {t("searchLabel")}
              </label>
              <input
                id="group-search"
                className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                value={draft}
                maxLength={PLAYER_NAME_MAX}
                placeholder={t("searchPlaceholder")}
                autoFocus={focus === "members"}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTyped();
                  }
                }}
              />
            </div>

            {draft.trim() !== "" && !exact && (
              <Button
                type="button"
                variant="ghost"
                className="h-12 justify-start gap-3 px-1"
                disabled={pending}
                onClick={addTyped}
              >
                <span className="grid size-9 place-items-center rounded-full bg-primary/15 text-primary">
                  <UserPlus className="size-4" aria-hidden />
                </span>
                {t("addNew", { name: draft.trim() })}
              </Button>
            )}

            {rows.length === 1 && draft.trim() === "" && (
              <p className="text-sm text-muted-foreground">{t("noRoster")}</p>
            )}

            <ul className="flex flex-col">
              {shown.map((row) => {
                const on = selected.has(row.key);
                return (
                  <li key={row.key} className="border-b border-border">
                    <label className="relative flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-1 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
                      <input
                        type="checkbox"
                        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
                        aria-label={row.name}
                        checked={on}
                        onChange={(event) =>
                          toggle(row.key, event.target.checked)
                        }
                      />
                      <Avatar name={row.name} />
                      <span className="min-w-0 flex-1 break-words">
                        {row.name}
                      </span>
                      {row.tag && (
                        <span className="text-xs text-muted-foreground">
                          {row.tag === "me" ? t("tagMe") : t("tagFriend")}
                        </span>
                      )}
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-md border-2",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/50",
                        )}
                      >
                        {on && <Check className="size-3.5" strokeWidth={3.2} />}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </form>

        <SheetFooter className="border-t border-border px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <div aria-live="polite" className="text-center text-sm">
            {error ? (
              <p role="alert" className="text-destructive">
                {te(error)}
              </p>
            ) : (
              blocked && (
                <p className="text-muted-foreground">
                  {noName ? t("needName") : t("needPlayers")}
                </p>
              )
            )}
          </div>
          <Button
            type="submit"
            form="group-sheet-form"
            size="lg"
            className="h-13 rounded-2xl text-base"
            disabled={pending || blocked}
          >
            {isNew
              ? count >= MIN_NEW
                ? t("createWith", { count })
                : t("create")
              : t("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
