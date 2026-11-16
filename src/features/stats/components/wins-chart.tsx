"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ChartTable } from "./chart-table";

export type WinsDatum = {
  playerId: string;
  name: string;
  wins: number;
  scoredPlays: number;
};

const ROW_PX = 40;
const NAME_MAX = 14;
const clip = (name: string) =>
  name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;

/**
 * Wins per player as ranked horizontal bars: one series, one hue (no legend box: the
 * title says what it is). Long names are clipped on the axis only; the tooltip and the
 * table carry them in full.
 */
export function WinsChart({ data }: { data: WinsDatum[] }) {
  const t = useTranslations("Stats.charts");
  const format = useFormatter();
  const config = {
    wins: { label: t("wins"), color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm font-medium">{t("winsTitle")}</figcaption>
      <ChartContainer
        config={config}
        aria-label={t("winsTitle")}
        className="w-full"
        style={{ height: data.length * ROW_PX + 32 }}
      >
        <BarChart
          accessibilityLayer
          data={data}
          layout="vertical"
          margin={{ left: 0, right: 28, top: 4, bottom: 4 }}
          barCategoryGap={12}
        >
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis
            type="number"
            allowDecimals={false}
            domain={[0, (max: number) => Math.max(1, max)]}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={104}
            tickLine={false}
            axisLine={false}
            tickFormatter={clip}
            tick={{ fill: "var(--foreground)", fontSize: 12 }}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={<ChartTooltipContent hideLabel={false} />}
          />
          <Bar
            dataKey="wins"
            fill="var(--color-wins)"
            radius={[0, 4, 4, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="wins"
              position="right"
              fill="var(--foreground)"
              fontSize={12}
              formatter={(v) => format.number(Number(v))}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
      <ChartTable
        caption={t("winsTitle")}
        columns={[t("tablePlayer"), t("wins"), t("tableScored")]}
        rows={data.map((d) => [
          d.name,
          format.number(d.wins),
          format.number(d.scoredPlays),
        ])}
      />
    </figure>
  );
}
