// Server-side barrel. Client components import from "./client" (pure helpers and types).
export {
  getGameCategoryStats,
  getGameStats,
  type GameCategoryStats,
  getMyStats,
  type GameStats,
  type GameSummary,
  type MyOverview,
  type MyStats,
  type Rival,
  type TopGame,
} from "./services/stats-service";
export {
  pivotSeries,
  topSeriesPlayers,
  winRate,
  type PlayerStat,
  type SeriesPoint,
  type SeriesRow,
} from "./format";
export { GameStatsPanel } from "./components/game-stats";
