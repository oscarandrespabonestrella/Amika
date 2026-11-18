import { useFormatter, useTranslations } from "next-intl";
import { pivotSeries, topSeriesPlayers, winRate } from "../format";
import type {
  GameCategoryStats,
  GameStats as GameStatsData,
} from "../services/stats-service";
import { CategoryTable } from "./category-table";
import { ScoreEvolutionChart } from "./score-evolution-chart";
import { WinsChart } from "./wins-chart";

const CHART_PLAYERS = 5;

/**
 * "Statistics" section of the game page. Renders nothing for a game without matches.
 * Everything comes from the viewer's own matches; players are grouped by id.
 */
export function GameStatsPanel({
  data,
  categories,
}: {
  data: GameStatsData;
  categories?: GameCategoryStats | null;
}) {
  const t = useTranslations("Stats.game");
  const format = useFormatter();
  const { summary, players, series } = data;
  if (summary.plays === 0) return null;

  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeZone: "UTC" });
  const dash = "–";

  const charted = topSeriesPlayers(players, CHART_PLAYERS);
  const nameOf = new Map(players.map((p) => [p.playerId, p.name]));
  const rows = pivotSeries(series, charted);
  const anyWins = players.some((p) => p.wins > 0);
  const scoredMatches = new Set(series.map((p) => p.seq)).size;

  return (
    <section
      aria-labelledby="stats-title"
      className="flex flex-col gap-3"
    >
      <h2 id="stats-title" className="text-base font-semibold">
        {t("title")}
      </h2>

      <dl className="grid grid-cols-3 gap-2">
        <Tile label={t("matches")} value={format.number(summary.plays)} />
        {summary.avgDurationMinutes !== null && (
          <Tile
            label={t("avgDuration")}
            value={t("minutes", {
              n: format.number(summary.avgDurationMinutes, {
                maximumFractionDigits: 0,
              }),
            })}
          />
        )}
        {summary.lastPlayedOn && (
          <Tile label={t("lastPlayed")} value={date(summary.lastPlayedOn)} />
        )}
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-2 font-medium">
                {t("player")}
              </th>
              {(
                ["matchesCol", "wins", "winRate", "average", "best"] as const
              ).map((k) => (
                <th
                  key={k}
                  scope="col"
                  className="py-2 pr-2 text-right font-medium"
                >
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const rate = winRate(p.wins, p.scoredPlays);
              return (
                <tr
                  key={p.playerId}
                  className="border-b border-border/60 last:border-0"
                >
                  <th
                    scope="row"
                    className="max-w-[14rem] py-2 pr-2 text-left font-medium break-words"
                  >
                    {p.name}
                  </th>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {format.number(p.plays)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {format.number(p.wins)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {rate === null
                      ? dash
                      : format.number(rate, {
                          style: "percent",
                          maximumFractionDigits: 0,
                        })}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {p.avgScore === null
                      ? dash
                      : format.number(p.avgScore, {
                          maximumFractionDigits: 2,
                        })}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {p.bestScore === null ? dash : format.number(p.bestScore)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {players.length > CHART_PLAYERS && (
        <p className="text-sm text-muted-foreground">
          {t("chartsNote", { n: CHART_PLAYERS })}
        </p>
      )}

      {anyWins && (
        <WinsChart
          data={players
            .filter((p) => p.wins > 0 || p.scoredPlays > 0)
            .map((p) => ({
              playerId: p.playerId,
              name: p.name,
              wins: p.wins,
              scoredPlays: p.scoredPlays,
            }))}
        />
      )}
      {scoredMatches >= 2 && (
        <ScoreEvolutionChart
          rows={rows}
          players={charted.map((id) => ({ id, name: nameOf.get(id) ?? "" }))}
        />
      )}
      {categories && <CategoryTable data={categories} />}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse gap-0.5 rounded-xl bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}
