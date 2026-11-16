import { ClipboardCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { PlaySummary } from "../services/play-service";

/** "Matches" section of the game page: how many, a way to log one, and the latest. */
export function PlaysPanel({
  gameId,
  plays,
}: {
  gameId: string;
  plays: PlaySummary[];
}) {
  const t = useTranslations("Plays.panel");
  const format = useFormatter();

  return (
    <section
      aria-labelledby="plays-title"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="plays-title"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <ClipboardCheck className="size-5 text-primary" aria-hidden />
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("count", { count: plays.length })}
          </p>
        </div>
        <Link
          href={`/games/${gameId}/plays/new`}
          className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t("log")}
        </Link>
      </div>

      {plays.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("emptyDescription")}</p>
      ) : (
        <ul aria-label={t("listLabel")} className="flex flex-col gap-2">
          {plays.map((play) => (
            <li key={play.id}>
              <Link
                href={`/games/${gameId}/plays/${play.id}`}
                className="flex flex-col gap-1.5 rounded-xl border border-border p-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <strong>
                    {format.dateTime(new Date(play.playedOn), {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    })}
                  </strong>
                  <span className="text-muted-foreground">
                    {play.sheetTitle ?? t("manual")}
                  </span>
                  {play.durationMinutes !== null && (
                    <span className="text-muted-foreground">
                      · {t("duration", { n: play.durationMinutes })}
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {play.participants.map((p, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5">
                      <span className="break-words">{p.name}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {p.total ?? "–"}
                      </span>
                      {p.isWinner && <Badge>{t("winner")}</Badge>}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
