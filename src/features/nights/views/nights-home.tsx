"use client";

import { CalendarDays, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { Group } from "@/features/groups/client";
import { Link, useRouter } from "@/i18n/navigation";
import { respondNightInviteAction } from "../actions/night-actions";
import { SectionLabel } from "../components/choice-chips";
import { NightTabs } from "../components/night-tabs";
import type { NightErrorCode } from "../error-codes";
import type { Ranked } from "../rank";
import type { PickerQuery } from "../schemas";
import type { NightInvite, NightSummary } from "../services/night-service";
import { NightPicker } from "./night-picker";

/** /nights: pick a game now (the main job), answer invitations, open my nights. */
export function NightsHome({
  invites,
  nights,
  groups,
  initial,
  query,
}: {
  invites: NightInvite[];
  nights: NightSummary[];
  groups: Group[];
  initial: Ranked[];
  query: PickerQuery;
}) {
  const t = useTranslations("Nights");
  const router = useRouter();
  const [error, setError] = useState<NightErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const open = nights.filter((n) => n.status === "open");
  const closed = nights.filter((n) => n.status === "closed");

  function respond(nightId: string, accept: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await respondNightInviteAction(nightId, accept);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <NightTabs current="now" />
      </header>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      )}

      {invites.length > 0 && (
        <section
          aria-labelledby="invites-title"
          className="flex flex-col gap-2.5"
        >
          <SectionLabel id="invites-title">{t("invites.title")}</SectionLabel>
          <ul className="flex flex-col gap-2">
            {invites.map((invite) => (
              <li
                key={invite.nightId}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold break-words">
                    {invite.title}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {invite.startsOn} ·{" "}
                    {t("invites.from", {
                      host: invite.hostName || t("detail.someone"),
                    })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    className="h-11 flex-1 px-4"
                    disabled={pending}
                    onClick={() => respond(invite.nightId, true)}
                  >
                    {t("invites.accept")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 flex-1 px-4"
                    disabled={pending}
                    onClick={() => respond(invite.nightId, false)}
                  >
                    {t("invites.reject")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NightList title={t("list.open")} nights={open} id="open-nights" />

      <NightPicker mode="now" groups={groups} initial={initial} query={query} />

      {nights.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
      )}
      <NightList title={t("list.closed")} nights={closed} id="closed-nights" />
    </div>
  );
}

function NightList({
  title,
  nights,
  id,
}: {
  title: string;
  nights: NightSummary[];
  id: string;
}) {
  const t = useTranslations("Nights.list");
  if (nights.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <SectionLabel id={id}>{title}</SectionLabel>
      <ul className="flex flex-col gap-2">
        {nights.map((n) => (
          <li key={n.id}>
            <Link
              href={`/nights/${n.id}`}
              className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card p-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                <CalendarDays className="size-5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{n.title}</span>
                <span className="text-sm text-muted-foreground">
                  {n.startsOn} · {t("games", { count: n.games })} ·{" "}
                  {n.isOwner ? t("hosting") : t("guest")}
                </span>
              </span>
              <ChevronRight
                className="size-5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
