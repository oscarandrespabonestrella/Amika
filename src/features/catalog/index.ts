// Public API of the catalog module. Other modules and routes import only from here.
export {
  createCustomGameAction,
  importGameAction,
  searchExternalAction,
  type CreateCustomGameResult,
} from "./actions/catalog-actions";
export { CustomGameForm } from "./components/custom-game-form";
export { ExternalSearch } from "./components/external-search";
export { GameCard } from "./components/game-card";
export { GameDetailView } from "./components/game-detail";
export { SearchForm } from "./components/search-form";
export { customGameSchema, parseSearchParams } from "./schemas";
export type { CustomGameInput, SearchParams } from "./schemas";
export {
  getGameDetail,
  getGameForEdit,
  type GameDetail,
} from "./services/game-service";
export type {
  ExternalSearchResult,
  ImportResult,
  SearchHit,
} from "./services/import-service";
export { searchExternalGames } from "./services/import-service";
export { searchLocalGames } from "./services/search-service";
export { getGameSource } from "./sources";
export type { GameKind, GameSummary, TermType } from "./types";
