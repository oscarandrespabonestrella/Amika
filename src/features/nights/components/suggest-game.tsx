"use client";

import { ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
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
import { suggestNightGameAction } from "../actions/night-actions";
import { toNightError, type NightErrorCode } from "../error-codes";

export type SuggestOption = { gameId: string; name: string };

/** Lets an accepted friend suggest a game of their own library (catalog games only). */
export function SuggestGame({
  nightId,
  options,
  disabled,
  onError,
  onDone,
}: {
  nightId: string;
  options: SuggestOption[];
  disabled?: boolean;
  onError: (code: NightErrorCode | null) => void;
  onDone: () => void;
}) {
  const t = useTranslations("Nights.detail.suggest");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(gameId: string) {
    setOpen(false);
    onError(null);
    startTransition(async () => {
      const result = await suggestNightGameAction(nightId, gameId);
      if (result.ok) onDone();
      else onError(toNightError(result.error));
    });
  }

  return (
    <section aria-labelledby="suggest-title" className="flex flex-col gap-3">
      <h2 id="suggest-title" className="font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-haspopup="listbox"
              aria-label={t("trigger")}
              aria-expanded={open}
              aria-controls={open ? "suggest-list" : undefined}
              disabled={disabled || pending}
              className="flex h-11 w-full max-w-sm items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 md:text-sm dark:bg-input/30"
            >
              <span className="text-muted-foreground">{t("trigger")}</span>
              <ChevronsUpDown
                className="size-4 shrink-0 opacity-50"
                aria-hidden
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) min-w-64 p-0"
          >
            <Command
              filter={(_value, search, keywords) =>
                (keywords ?? [])
                  .join(" ")
                  .toLocaleLowerCase()
                  .includes(search.trim().toLocaleLowerCase())
                  ? 1
                  : 0
              }
            >
              <CommandInput placeholder={t("search")} maxLength={100} />
              <CommandList id="suggest-list">
                <CommandEmpty>{t("empty")}</CommandEmpty>
                <CommandGroup>
                  {options.map((o) => (
                    <CommandItem
                      key={o.gameId}
                      value={o.gameId}
                      keywords={[o.name]}
                      onSelect={() => choose(o.gameId)}
                    >
                      <span className="min-w-0 break-words">{o.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </section>
  );
}
