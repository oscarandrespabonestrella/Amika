"use client";

import { Check, Dices, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Group } from "@/features/groups/client";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  createNightAction,
  inviteToNightAction,
} from "../actions/night-actions";
import {
  ChoiceChips,
  chipClass,
  SectionLabel,
  type ChipOption,
} from "../components/choice-chips";
import { GameThumb, gameMeta } from "../components/game-thumb";
import { ReasonBadges } from "../components/reason-badges";
import { SpinButton, SpinResult, useSpin } from "../components/spin-card";
import { toNightError, type NightErrorCode } from "../error-codes";
import type { Ranked } from "../rank";
import type { PickerQuery } from "../schemas";

const subscribeNothing = () => () => {};

const pad = (v: number) => String(v).padStart(2, "0");
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The viewer's own date as YYYY-MM-DD. */
function localToday(): string {
  return isoOf(new Date());
}

/** `iso` plus `days`, as a local calendar date. */
function addDays(iso: string, days: number): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d + days);
}

const MINUTE_PRESETS = [30, 60, 120, 180];
const PLAYER_PRESETS = [2, 3, 4, 5, 6];
const DAY_CHIPS = 4;
const TITLE_MAX = 80;

/** A friend who will get the night's invitation when the plan is saved. */
export type GroupFriend = { userId: string; name: string };

/**
 * The selector: filters live in the URL (the server re-ranks), the shortlist's
 * checkboxes decide what goes into the spin (`now`) or onto the night (`plan`).
 */
export function NightPicker({
  mode,
  groups,
  initial,
  query,
  groupFriends = {},
}: {
  mode: "now" | "plan";
  groups: Group[];
  initial: Ranked[];
  query: PickerQuery;
  /** Plan mode: per group, its players linked to friends (they get invited). */
  groupFriends?: Record<string, GroupFriend[]>;
}) {
  const t = useTranslations("Nights");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [title, setTitle] = useState("");
  // The default date is the viewer's own today, known only on the client.
  const [pickedDate, setDate] = useState("");
  const [otherDate, setOtherDate] = useState(false);
  const localDay = useSyncExternalStore(subscribeNothing, localToday, () => "");
  const date = pickedDate !== "" ? pickedDate : localDay;
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<NightErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const group = groups.find((g) => g.id === query.groupId);
  const groupId = group?.id;
  const kept = initial.filter((c) => !off.has(c.gameId));
  const spinState = useSpin(kept);
  const friends = groupId ? (groupFriends[groupId] ?? []) : [];

  function apply(next: PickerQuery) {
    const params = new URLSearchParams();
    if (next.players) params.set("players", String(next.players));
    if (next.maxMinutes) params.set("maxMinutes", String(next.maxMinutes));
    if (next.groupId) params.set("groupId", next.groupId);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function duration(minutes: number): string {
    if (minutes < 60) return t("filters.minutes", { minutes });
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0
      ? t("filters.hours", { hours })
      : t("filters.hoursMinutes", { hours, minutes: rest });
  }

  const whoOptions: ChipOption<string>[] = [
    { value: "", label: t("filters.anyone") },
    ...groups.map((g) => ({
      value: g.id,
      label: g.name,
      extra: `· ${g.members.length}`,
      ariaLabel: t("filters.groupOption", {
        name: g.name,
        count: g.members.length,
      }),
    })),
  ];
  const playerValues = [
    ...new Set([...PLAYER_PRESETS, ...(query.players ? [query.players] : [])]),
  ].sort((a, b) => a - b);
  const playerOptions: ChipOption<number>[] = [
    { value: 0, label: t("filters.anyCount") },
    ...playerValues.map((n) => ({
      value: n,
      label: String(n),
      ariaLabel: t("filters.playersCount", { count: n }),
    })),
  ];
  const minuteValues = [
    ...new Set([
      ...MINUTE_PRESETS,
      ...(query.maxMinutes ? [query.maxMinutes] : []),
    ]),
  ].sort((a, b) => a - b);
  const timeOptions: ChipOption<number>[] = [
    { value: 0, label: t("filters.anyTime") },
    ...minuteValues.map((m) => ({ value: m, label: duration(m) })),
  ];

  const days = localDay
    ? Array.from({ length: DAY_CHIPS }, (_, i) => addDays(localDay, i))
    : [];
  const dayIsos = days.map(isoOf);
  const showOther = otherDate || (date !== "" && !dayIsos.includes(date));

  function save() {
    setError(null);
    const name =
      title.trim() ||
      (group
        ? t("plan.defaultTitleGroup", { group: group.name })
        : t("plan.defaultTitle"));
    startTransition(async () => {
      const result = await createNightAction({
        title: name.slice(0, TITLE_MAX),
        startsOn: date,
        players: groupId ? undefined : query.players,
        maxMinutes: query.maxMinutes,
        groupId,
        gameIds: kept.map((c) => c.gameId),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The group's friends are invited right away; a failed one can be invited later.
      for (const friend of friends) {
        const invited = await inviteToNightAction(result.id, friend.userId);
        if (!invited.ok && toNightError(invited.error) !== "already") break;
      }
      router.push(`/nights/${result.id}`);
    });
  }

  const playHref = spinState.picked
    ? `/games/${spinState.picked.gameId}/plays/new${groupId ? `?group=${groupId}` : ""}`
    : null;

  return (
    <div className="flex flex-col gap-6">
      {mode === "plan" && (
        <>
          <section
            aria-labelledby="when-label"
            className="flex flex-col gap-2.5"
          >
            <SectionLabel id="when-label">{t("plan.when")}</SectionLabel>
            <div
              role="group"
              aria-labelledby="when-label"
              className="flex flex-wrap gap-2"
            >
              {days.map((d, i) => {
                const iso = dayIsos[i];
                const on = !showOther && date === iso;
                return (
                  <button
                    key={iso}
                    type="button"
                    aria-pressed={on}
                    aria-label={new Intl.DateTimeFormat(locale, {
                      dateStyle: "full",
                    }).format(d)}
                    onClick={() => {
                      setOtherDate(false);
                      setDate(iso);
                    }}
                    className={cn(
                      "flex h-17 w-16 flex-col items-center justify-center gap-0.5 rounded-2xl border text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <span aria-hidden>
                      {new Intl.DateTimeFormat(locale, {
                        weekday: "short",
                      }).format(d)}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "text-xl font-bold",
                        !on && "text-foreground",
                      )}
                    >
                      {d.getDate()}
                    </span>
                  </button>
                );
              })}
              {days.length > 0 && (
                <button
                  type="button"
                  aria-pressed={showOther}
                  onClick={() => setOtherDate(true)}
                  className={cn(
                    "flex h-17 w-16 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    showOther
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Plus className="size-5" aria-hidden />
                  {t("plan.otherDate")}
                </button>
              )}
            </div>
            {showOther && (
              <div className="flex max-w-56 flex-col gap-1.5">
                <Label htmlFor="night-date">{t("plan.dateLabel")}</Label>
                <Input
                  id="night-date"
                  className="h-11"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
            )}
          </section>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="night-title">{t("plan.titleLabel")}</Label>
            <Input
              id="night-title"
              className="h-12"
              value={title}
              maxLength={TITLE_MAX}
              placeholder={
                group
                  ? t("plan.defaultTitleGroup", { group: group.name })
                  : t("plan.defaultTitle")
              }
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
        </>
      )}

      <section aria-labelledby="who-label" className="flex flex-col gap-2.5">
        <SectionLabel id="who-label">
          {mode === "plan" ? t("filters.who") : t("filters.whoNow")}
        </SectionLabel>
        <ChoiceChips
          labelledBy="who-label"
          options={whoOptions}
          value={groupId ?? ""}
          onChange={(v) => apply({ ...query, groupId: v || undefined })}
          trailing={
            <Link href="/groups" className={chipClass()}>
              <Plus className="size-4" aria-hidden />
              {groups.length === 0
                ? t("filters.createGroup")
                : t("filters.manageGroups")}
            </Link>
          }
        />
        {mode === "plan" && group && (
          <p className="text-sm text-muted-foreground">
            {friends.length > 0
              ? t("plan.inviteHint", {
                  count: friends.length,
                  names: friends.map((f) => f.name).join(", "),
                })
              : t("plan.noFriendsHint")}
          </p>
        )}
      </section>

      {!group && (
        <section
          aria-labelledby="count-label"
          className="flex flex-col gap-2.5"
        >
          <SectionLabel id="count-label">{t("filters.players")}</SectionLabel>
          <ChoiceChips
            labelledBy="count-label"
            options={playerOptions}
            value={query.players ?? 0}
            onChange={(v) => apply({ ...query, players: v || undefined })}
          />
        </section>
      )}

      <section aria-labelledby="time-label" className="flex flex-col gap-2.5">
        <SectionLabel id="time-label">{t("filters.maxMinutes")}</SectionLabel>
        <ChoiceChips
          labelledBy="time-label"
          options={timeOptions}
          value={query.maxMinutes ?? 0}
          onChange={(v) => apply({ ...query, maxMinutes: v || undefined })}
        />
      </section>

      {mode === "now" && <SpinResult state={spinState} playHref={playHref} />}

      {initial.length === 0 ? (
        <EmptyState
          icon={Dices}
          title={t("shortlist.title")}
          description={t("shortlist.empty")}
        />
      ) : (
        <section aria-labelledby="shortlist-title" className="flex flex-col">
          <div className="flex items-baseline justify-between gap-3">
            <SectionLabel id="shortlist-title">
              {mode === "plan" ? t("plan.gamesTitle") : t("shortlist.title")}
            </SectionLabel>
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {t("shortlist.picked", {
                count: kept.length,
                total: initial.length,
              })}
            </span>
          </div>
          <p className="mt-1 mb-1 text-sm text-muted-foreground">
            {mode === "plan" ? t("plan.gamesHint") : t("shortlist.hint")}
          </p>
          <ul className="flex flex-col">
            {initial.map((c) => (
              <ShortlistRow
                key={c.gameId}
                game={c}
                checked={!off.has(c.gameId)}
                onChange={(on) =>
                  setOff((prev) => {
                    const next = new Set(prev);
                    if (on) next.delete(c.gameId);
                    else next.add(c.gameId);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        </section>
      )}

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-2xl md:border">
        {mode === "now" ? (
          <SpinButton state={spinState} count={kept.length} />
        ) : (
          <>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t(`errors.${error}`)}
              </p>
            )}
            {kept.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("plan.needOne")}
              </p>
            )}
            <Button
              type="button"
              size="lg"
              className="h-13 w-full rounded-2xl text-base"
              disabled={pending || kept.length === 0 || !date}
              onClick={save}
            >
              {pending
                ? t("plan.saving")
                : friends.length > 0
                  ? t("plan.saveAndInvite", { count: friends.length })
                  : t("plan.save")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {t("plan.afterSave")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ShortlistRow({
  game,
  checked,
  onChange,
}: {
  game: Ranked;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTranslations("Nights.shortlist");
  const meta = gameMeta(game);
  return (
    <li className="border-b border-border last:border-b-0">
      <label
        className={cn(
          "relative flex min-h-18 cursor-pointer items-center gap-3 rounded-lg px-1 py-2 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
          !checked && "opacity-60",
        )}
      >
        <input
          type="checkbox"
          className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
          checked={checked}
          aria-label={t("include", { name: game.name })}
          onChange={(event) => onChange(event.target.checked)}
        />
        <GameThumb coverUrl={game.coverUrl} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-semibold break-words">{game.name}</span>
          <ReasonBadges reasons={game.reasons} />
        </span>
        {meta && (
          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
            {meta}
          </span>
        )}
        <span
          aria-hidden
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md border-2",
            checked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/50",
          )}
        >
          {checked && <Check className="size-3.5" strokeWidth={3.2} />}
        </span>
      </label>
    </li>
  );
}
