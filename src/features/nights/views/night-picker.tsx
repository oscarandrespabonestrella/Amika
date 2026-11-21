"use client";

import { Dices } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Group } from "@/features/groups/client";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createNightAction } from "../actions/night-actions";
import { ReasonBadges } from "../components/reason-badges";
import { SpinCard } from "../components/spin-card";
import type { NightErrorCode } from "../error-codes";
import type { Ranked } from "../rank";
import type { PickerQuery } from "../schemas";

const subscribeNothing = () => () => {};

/** The viewer's own date as YYYY-MM-DD. */
function localToday(): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MINUTE_PRESETS = [30, 60, 90, 120, 180];

/**
 * The selector: filters live in the URL (the server re-ranks), the shortlist is
 * spun for one game. In `plan` mode the shortlist can be edited and saved as a night.
 */
export function NightPicker({
  mode,
  groups,
  initial,
  query,
}: {
  mode: "now" | "plan";
  groups: Group[];
  initial: Ranked[];
  query: PickerQuery;
}) {
  const t = useTranslations("Nights");
  const router = useRouter();
  const pathname = usePathname();
  const [players, setPlayers] = useState(
    query.players === undefined ? "" : String(query.players),
  );
  const [title, setTitle] = useState("");
  // The default date is the viewer's own today, known only on the client.
  const [pickedDate, setDate] = useState("");
  const localDay = useSyncExternalStore(subscribeNothing, localToday, () => "");
  const date = pickedDate !== "" ? pickedDate : localDay;
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<NightErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const groupId = groups.some((g) => g.id === query.groupId)
    ? query.groupId
    : undefined;
  const kept = initial.filter((c) => !removed.has(c.gameId));
  const minuteOptions = [
    ...new Set([
      ...MINUTE_PRESETS,
      ...(query.maxMinutes ? [query.maxMinutes] : []),
    ]),
  ].sort((a, b) => a - b);

  function apply(next: PickerQuery) {
    const params = new URLSearchParams();
    if (next.players) params.set("players", String(next.players));
    if (next.maxMinutes) params.set("maxMinutes", String(next.maxMinutes));
    if (next.groupId) params.set("groupId", next.groupId);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function commitPlayers() {
    const n = players.trim() === "" ? undefined : Number(players);
    const valid = n !== undefined && Number.isInteger(n) && n >= 1 && n <= 100;
    if (n !== undefined && !valid) {
      setPlayers(query.players === undefined ? "" : String(query.players));
      return;
    }
    if (n !== query.players) apply({ ...query, players: n });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await createNightAction({
        title,
        startsOn: date,
        players: groupId ? undefined : query.players,
        maxMinutes: query.maxMinutes,
        groupId,
        gameIds: kept.map((c) => c.gameId),
      });
      if (result.ok) router.push(`/nights/${result.id}`);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        role="search"
        aria-label={t("filters.label")}
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          commitPlayers();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="picker-group">{t("filters.group")}</Label>
          <NativeSelect
            id="picker-group"
            className="h-11"
            value={groupId ?? ""}
            onChange={(event) =>
              apply({ ...query, groupId: event.target.value || undefined })
            }
          >
            <option value="">{t("filters.noGroup")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="picker-players">{t("filters.players")}</Label>
          <Input
            id="picker-players"
            className="h-11"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            placeholder={t("filters.playersHint")}
            value={groupId ? "" : players}
            disabled={Boolean(groupId)}
            aria-describedby={groupId ? "picker-players-hint" : undefined}
            onChange={(event) => setPlayers(event.target.value)}
            onBlur={commitPlayers}
          />
          {groupId && (
            <p
              id="picker-players-hint"
              className="text-xs text-muted-foreground"
            >
              {t("filters.groupSetsPlayers")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="picker-minutes">{t("filters.maxMinutes")}</Label>
          <NativeSelect
            id="picker-minutes"
            className="h-11"
            value={query.maxMinutes ?? ""}
            onChange={(event) =>
              apply({
                ...query,
                maxMinutes: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
          >
            <option value="">{t("filters.anyTime")}</option>
            {minuteOptions.map((m) => (
              <option key={m} value={m}>
                {t("filters.minutes", { minutes: m })}
              </option>
            ))}
          </NativeSelect>
        </div>
      </form>

      {initial.length === 0 ? (
        <EmptyState
          icon={Dices}
          title={t("shortlist.title")}
          description={t("shortlist.empty")}
        />
      ) : (
        <section
          aria-labelledby="shortlist-title"
          className="flex flex-col gap-3"
        >
          <h2 id="shortlist-title" className="font-semibold">
            {t("shortlist.title")}
          </h2>
          <ul className="flex flex-col gap-2">
            {initial.map((c) => {
              const out = removed.has(c.gameId);
              return (
                <li
                  key={c.gameId}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <div
                    className={cn(
                      "flex min-w-0 flex-col gap-1.5",
                      out && "opacity-50",
                    )}
                  >
                    <span className="truncate font-medium">{c.name}</span>
                    {out ? (
                      <span className="text-xs text-muted-foreground">
                        {t("plan.removedLabel")}
                      </span>
                    ) : (
                      <ReasonBadges reasons={c.reasons} />
                    )}
                  </div>
                  {mode === "plan" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 shrink-0 px-4"
                      onClick={() =>
                        setRemoved((prev) => {
                          const next = new Set(prev);
                          if (out) next.delete(c.gameId);
                          else next.add(c.gameId);
                          return next;
                        })
                      }
                    >
                      {out ? t("plan.restore") : t("plan.remove")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <SpinCard candidates={kept} groupId={groupId} />

      {mode === "plan" && (
        <form
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="night-title">{t("plan.titleLabel")}</Label>
              <Input
                id="night-title"
                className="h-11"
                value={title}
                maxLength={80}
                placeholder={t("plan.titlePlaceholder")}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="night-date">{t("plan.dateLabel")}</Label>
              <Input
                id="night-date"
                className="h-11"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>
          {kept.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("plan.needOne")}</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="h-11 w-fit px-6"
            disabled={
              pending || kept.length === 0 || title.trim() === "" || !date
            }
          >
            {pending ? t("plan.saving") : t("plan.save")}
          </Button>
        </form>
      )}
    </div>
  );
}
