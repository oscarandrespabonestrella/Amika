// Client-safe barrel: pure helpers, types and chart components (no server-only code).
export { pivotSeries, topSeriesPlayers, winRate } from "./format";
export type { PlayerStat, SeriesPoint, SeriesRow } from "./format";
export { ChartTable } from "./components/chart-table";
export { ScoreEvolutionChart } from "./components/score-evolution-chart";
export { WinsChart, type WinsDatum } from "./components/wins-chart";
