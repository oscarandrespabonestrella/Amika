"use client";

import { useFormatter, useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { SeriesRow } from "../format";
import { ChartTable } from "./chart-table";

/**
 * Each charted player's total in each match, one line per player (at most 5: the five
 * `--chart-N` slots, assigned in the order of `players` and never cycled). The x axis is
 * the match number, so matches on the same day never collide; the tooltip shows the
 * date. A player who did not score in a match leaves a gap, never a zero.
 */
export function ScoreEvolutionChart({
  rows,
  players,
}: {
  rows: SeriesRow[];
  players: { id: string; name: string }[];
}) {
  const t = useTranslations("Stats.charts");
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeZone: "UTC" });

  const config: ChartConfig = Object.fromEntries(
    players.map((p, i) => [
      p.id,
      { label: p.name, color: `var(--chart-${i + 1})` },
    ]),
  );

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm font-medium">
        {t("evolutionTitle")}
      </figcaption>
      <ChartContainer
        config={config}
        aria-label={t("evolutionTitle")}
        className="h-64 w-full"
      >
        <LineChart
          accessibilityLayer
          data={rows}
          margin={{ left: 0, right: 12, top: 8, bottom: 4 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="seq"
            type="number"
            domain={["dataMin", "dataMax"]}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            label={{
              value: t("match"),
              position: "insideBottomRight",
              offset: -2,
              fill: "var(--muted-foreground)",
              fontSize: 12,
            }}
          />
          <YAxis
            width={40}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v) => format.number(Number(v))}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as SeriesRow | undefined;
                  return row
                    ? `${t("matchN", { n: row.seq })} · ${day(String(row.playedOn))}`
                    : "";
                }}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {players.map((p, i) => (
            <Line
              key={p.id}
              dataKey={p.id}
              type="monotone"
              stroke={`var(--chart-${i + 1})`}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              connectNulls={false}
              isAnimationActive={false}
              dot={{
                r: 4,
                fill: `var(--chart-${i + 1})`,
                stroke: "var(--card)",
                strokeWidth: 2,
              }}
              activeDot={{ r: 6, stroke: "var(--card)", strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <ChartTable
        caption={t("evolutionTitle")}
        columns={[t("match"), t("tableDate"), ...players.map((p) => p.name)]}
        rows={rows.map((r) => [
          String(r.seq),
          day(String(r.playedOn)),
          ...players.map((p) => {
            const v = r[p.id];
            return typeof v === "number" ? format.number(v) : "–";
          }),
        ])}
      />
    </figure>
  );
}
