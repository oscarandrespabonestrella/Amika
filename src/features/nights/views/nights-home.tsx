"use client";

import { Dices } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Group } from "@/features/groups/client";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { respondNightInviteAction } from "../actions/night-actions";
import type { NightErrorCode } from "../error-codes";
import type { Ranked } from "../rank";
import type { PickerQuery } from "../schemas";
import type { NightInvite, NightSummary } from "../services/night-service";
import { NightPicker } from "./night-picker";

/** /nights: pick a game now, plan a night, answer invitations, see my nights. */
export function NightsHome({
  invites,
  nights,
  groups,
  initial,
  query,
  today,
}: {
  invites: NightInvite[];
  nights: NightSummary[];
  groups: Group[];
  initial: Ranked[];
  query: PickerQuery;
  today: string;
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
    <div className="flex max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      )}

      {invites.length > 0 && (
        <section
          aria-labelledby="invites-title"
          className="flex flex-col gap-3"
        >
          <h2 id="invites-title" className="font-semibold">
            {t("invites.title")}
          </h2>
          <ul className="flex flex-col gap-2">
            {invites.map((invite) => (
              <li
                key={invite.nightId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{invite.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {invite.startsOn} ·{" "}
                    {t("invites.from", { host: invite.hostName })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    className="h-11 px-4"
                    disabled={pending}
                    onClick={() => respond(invite.nightId, true)}
                  >
                    {t("invites.accept")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
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

      <section
        aria-labelledby="pick-title"
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="pick-title" className="flex items-center gap-2 font-semibold">
            <Dices className="size-5 text-primary" aria-hidden />
            {t("pickNow")}
          </h2>
          <Link
            href="/nights/new"
            className={cn(buttonVariants({ variant: "outline" }), "h-11 px-5")}
          >
            {t("planNight")}
          </Link>
        </div>
        <NightPicker
          mode="now"
          groups={groups}
          initial={initial}
          query={query}
          today={today}
        />
      </section>

      {nights.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
      )}
      <NightList title={t("list.open")} nights={open} />
      <NightList title={t("list.closed")} nights={closed} />
    </div>
  );
}

function NightList({
  title,
  nights,
}: {
  title: string;
  nights: NightSummary[];
}) {
  const t = useTranslations("Nights.list");
  if (nights.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{title}</h2>
      <ul className="flex flex-col gap-2">
        {nights.map((n) => (
          <li key={n.id}>
            <Link
              href={`/nights/${n.id}`}
              className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{n.title}</span>
                <span className="text-sm text-muted-foreground">
                  {n.startsOn} · {t("games", { count: n.games })}
                </span>
              </span>
              <Badge variant="secondary">
                {n.isOwner ? t("hosting") : t("guest")}
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
