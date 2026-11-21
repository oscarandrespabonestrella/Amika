"use client";

import { Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { NO_NAMES, PLAYER_NAMES } from "../names";
import { clamp } from "../random";
import { makeTeams, MAX_TEAMS, MIN_TEAMS } from "../teams";
import type { ToolRoster } from "../types";
import { useStoredState } from "../use-stored-state";
import { ActionBar, primaryAction, SettingRow } from "./controls";
import { NamesEditor } from "./names-editor";
import { ToolFrame } from "./tool-frame";

const TEAM_COUNT = z.number().int().min(MIN_TEAMS).max(MAX_TEAMS);
const DOTS = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-primary",
];

/** Splits the players into random, evenly sized teams. */
export function TeamGenerator({ roster }: { roster: ToolRoster }) {
  const t = useTranslations("Tools.teams");
  const [names, setNames] = useStoredState("players", PLAYER_NAMES, NO_NAMES);
  const [count, setCount] = useStoredState("team-count", TEAM_COUNT, 2);
  const [teams, setTeams] = useState<string[][]>([]);

  const make = () => setTeams(makeTeams(names, count));
  const edit = (next: string[]) => {
    setNames(next);
    setTeams([]);
  };

  return (
    <ToolFrame id="teams" onReset={() => setTeams([])} fullscreen={false}>
      {teams.length > 0 && (
        <ul aria-label={t("result")} className="grid gap-3 sm:grid-cols-2">
          {teams.map((team, i) => (
            <li
              key={i}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 motion-safe:animate-[tools-pop_0.3s_ease-out]"
            >
              <h2 className="flex items-center gap-2 font-semibold">
                <span
                  aria-hidden
                  className={`size-3 rounded-full ${DOTS[i % DOTS.length]}`}
                />
                {t("team", { number: i + 1 })}
                <span className="text-sm font-normal text-muted-foreground">
                  {team.length}
                </span>
              </h2>
              <ul className="flex flex-col gap-1 text-[15px]">
                {team.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <SettingRow label={t("count")}>
        <Stepper
          label={t("count")}
          decreaseLabel={t("fewer")}
          increaseLabel={t("more")}
          value={count}
          onChange={(v) => {
            if (v === undefined) return;
            setCount(clamp(Math.trunc(v), MIN_TEAMS, MAX_TEAMS));
            setTeams([]);
          }}
        />
      </SettingRow>

      <NamesEditor
        names={names}
        onChange={edit}
        roster={roster}
        title={t("players")}
        placeholder={t("placeholder")}
      />

      <ActionBar>
        <Button
          type="button"
          size="lg"
          className={primaryAction}
          onClick={make}
          disabled={names.length < 2}
        >
          <Shuffle aria-hidden />
          {teams.length > 0 ? t("again") : t("make")}
        </Button>
      </ActionBar>
    </ToolFrame>
  );
}
