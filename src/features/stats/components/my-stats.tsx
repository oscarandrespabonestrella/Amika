import { BarChart3, UserRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { EmptyState } from "@/components/empty-state";
import { Link } from "@/i18n/navigation";
import { winRate } from "../format";
import type { MyStats as MyStatsData } from "../services/stats-service";
import { HeadToHead } from "./head-to-head";

const linkClass =
  "inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50";

/** Content of the Statistics page: the viewer's record as their "me" player. */
export function MyStatsView({ data }: { data: MyStatsData }) {
  const t = useTranslations("Stats.page");
  const format = useFormatter();
  const { overview, topGames, rivals } = data;

  if (overview.mePlayerId === null) {
    return (
      <div className="flex flex-col items-center gap-4">
        <EmptyState
          icon={UserRound}
          title={t("noMeTitle")}
          description={t("noMeDescription")}
        />
        <Link href="/players" className={linkClass}>
          {t("openPlayers")}
        </Link>
      </div>
    );
  }

  if (overview.plays === 0) {
    return (
      <div className="flex flex-col items-center gap-4">
        <EmptyState
          icon={BarChart3}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
        <Link href="/games" className={linkClass}>
          {t("browse")}
        </Link>
      </div>
    );
  }

  const rate = winRate(overview.wins, overview.scoredPlays);
  const maxPlays = Math.max(1, ...topGames.map((g) => g.plays));

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t("matches")} value={format.number(overview.plays)} />
        <Tile label={t("wins")} value={format.number(overview.wins)} />
        <Tile
          label={t("winRate")}
          value={
            rate === null
              ? "–"
              : format.number(rate, {
                  style: "percent",
                  maximumFractionDigits: 0,
                })
          }
        />
        <Tile
          label={t("gamesPlayed")}
          value={format.number(overview.gamesPlayed)}
        />
      </dl>

      <section
        aria-labelledby="top-games-title"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
      >
        <h2
          id="top-games-title"
          className="text-lg font-semibold tracking-tight"
        >
          {t("topTitle")}
        </h2>
        <ol aria-label={t("topTitle")} className="flex flex-col gap-3">
          {topGames.map((g) => (
            <li key={g.gameId} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <Link
                  href={`/games/${g.gameId}`}
                  className="font-medium break-words underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {g.name}
                </Link>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {t("topMatches", { count: g.plays })} ·{" "}
                  {t("topWins", { count: g.wins })}
                </span>
              </div>
              <span
                aria-hidden
                className="block h-2 rounded-r-sm bg-[var(--chart-1)]"
                style={{ width: `${(g.plays / maxPlays) * 100}%` }}
              />
            </li>
          ))}
        </ol>
      </section>

      <HeadToHead rivals={rivals} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
