"use client";

import { ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { normalizePlayerName } from "../normalize";
import { PLAYER_NAME_MAX } from "../schemas";
import type { Player } from "../services/player-service";

export type PickedPlayer = { playerId: string | null; name: string };

type Props = {
  /** DOM id of the trigger; also part of its accessible name. */
  id: string;
  /** DOM id of the visible label element that names this picker (e.g. "Name of player 2"). */
  labelId: string;
  value: PickedPlayer;
  roster: readonly Player[];
  /** Roster players already used by OTHER rows of the same match: not offered again. */
  takenIds: ReadonlySet<string>;
  /** Normalized names already used by other rows (also stops a "new" name that clashes). */
  takenNames: ReadonlySet<string>;
  onChange: (value: PickedPlayer) => void;
  /** Called whenever the list closes (so the form can explain an empty choice). */
  onClosed?: () => void;
};

/**
 * A searchable list of the user's players. Typing a name that is not in the roster
 * offers "Add “name”". The same player can never be chosen twice in one match. A
 * name that normalizes like an existing player ("ana ", "Aná") finds that player
 * instead of creating a second one. Keyboard: arrows move, Enter chooses, Escape
 * closes and returns focus to the button.
 */
export function PlayerPicker({
  id,
  labelId,
  value,
  roster,
  takenIds,
  takenNames,
  onChange,
  onClosed,
}: Props) {
  const t = useTranslations("Players.picker");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const normalized = normalizePlayerName(trimmed);
  const options = roster.filter((player) => !takenIds.has(player.id));
  const exists = roster.some(
    (player) => normalizePlayerName(player.name) === normalized,
  );
  const canCreate =
    trimmed !== "" &&
    trimmed.length <= PLAYER_NAME_MAX &&
    !exists &&
    !takenNames.has(normalized);

  function choose(next: PickedPlayer) {
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          onClosed?.();
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-labelledby={`${labelId} ${id}`}
          className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        >
          <span
            className={
              value.name ? "min-w-0 break-words" : "text-muted-foreground"
            }
          >
            {value.name || t("choose")}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
      >
        <Command
          // Accent- and case-insensitive, like the database's normalization.
          filter={(itemValue, search) =>
            normalizePlayerName(itemValue).includes(normalizePlayerName(search))
              ? 1
              : 0
          }
        >
          <CommandInput
            placeholder={t("search")}
            value={query}
            onValueChange={setQuery}
            maxLength={PLAYER_NAME_MAX}
          />
          <CommandList id={`${id}-list`}>
            <CommandEmpty>{t("empty")}</CommandEmpty>
            {options.length > 0 && (
              <CommandGroup heading={t("roster")}>
                {options.map((player) => (
                  <CommandItem
                    key={player.id}
                    value={player.name}
                    onSelect={() =>
                      choose({ playerId: player.id, name: player.name })
                    }
                  >
                    <span className="min-w-0 break-words">{player.name}</span>
                    {player.isMe && (
                      <span className="text-muted-foreground">
                        {t("meSuffix")}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {canCreate && (
              <CommandGroup>
                <CommandItem
                  // Always listed, whatever the search text matches.
                  forceMount
                  value={`__create__ ${trimmed}`}
                  onSelect={() => choose({ playerId: null, name: trimmed })}
                >
                  <Plus className="size-4" aria-hidden />
                  <span className="min-w-0 break-words">
                    {t("create", { name: trimmed })}
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
