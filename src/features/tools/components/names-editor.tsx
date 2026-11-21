"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  normalizePlayerName,
  PLAYER_NAME_MAX,
} from "@/features/players/client";
import { addNames, MAX_NAMES } from "../names";
import type { ToolRoster } from "../types";
import { chipClass, SectionLabel } from "./controls";

/**
 * A list of names (players, or options for the wheel) that is saved on the device and
 * can be filled from the user's own players and groups. Controlled: the tool keeps the
 * list so it can react to changes.
 */
export function NamesEditor({
  names,
  onChange,
  roster,
  title,
  placeholder,
}: {
  names: string[];
  onChange: (names: string[]) => void;
  roster: ToolRoster;
  title: string;
  placeholder: string;
}) {
  const t = useTranslations("Tools.names");
  const [draft, setDraft] = useState("");
  const headingId = useId();
  const inputId = useId();

  const taken = new Set(names.map(normalizePlayerName));
  const players = roster.players.filter(
    (p) => !taken.has(normalizePlayerName(p.name)),
  );
  const groups = roster.groups.filter((g) =>
    g.members.some((m) => !taken.has(normalizePlayerName(m))),
  );
  const full = names.length >= MAX_NAMES;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    // Commas separate several names typed at once.
    onChange(addNames(names, draft.split(",")));
    setDraft("");
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel id={headingId}>
          {title}{" "}
          <span className="font-normal tabular-nums">
            {names.length}/{MAX_NAMES}
          </span>
        </SectionLabel>
        {names.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-2.5"
            onClick={() => onChange([])}
          >
            {t("clear")}
          </Button>
        )}
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          {placeholder}
        </label>
        <Input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          maxLength={PLAYER_NAME_MAX * 4}
          autoComplete="off"
          disabled={full}
          className="h-11 flex-1 rounded-xl px-3.5"
        />
        <Button
          type="submit"
          variant="secondary"
          className="h-11 gap-1.5 rounded-xl px-4"
          disabled={full || draft.trim() === ""}
        >
          <Plus aria-hidden />
          {t("add")}
        </Button>
      </form>

      {names.length > 0 ? (
        <ul aria-label={title} className="flex flex-wrap gap-2">
          {names.map((name) => (
            <li
              key={name}
              className="inline-flex h-10 items-center gap-1 rounded-full border border-border bg-card pr-1 pl-3.5 text-sm font-medium"
            >
              <span className="max-w-40 truncate">{name}</span>
              <button
                type="button"
                aria-label={t("remove", { name })}
                onClick={() => onChange(names.filter((n) => n !== name))}
                className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
      {full && (
        <p className="text-sm text-muted-foreground">
          {t("full", { max: MAX_NAMES })}
        </p>
      )}

      {(players.length > 0 || groups.length > 0) && !full && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t("fromRoster")}</p>
          <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => onChange(addNames(names, group.members))}
                className={chipClass(true)}
              >
                {t("group", { name: group.name, count: group.members.length })}
              </button>
            ))}
            {players.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => onChange(addNames(names, [player.name]))}
                className={chipClass()}
              >
                <Plus className="size-3.5" aria-hidden />
                {player.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
