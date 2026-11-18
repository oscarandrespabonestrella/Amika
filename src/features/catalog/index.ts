// Public API of the catalog module. Other modules and routes import only from here.
export {
  createCustomGameAction,
  importGameAction,
  searchExternalAction,
  type CreateCustomGameResult,
} from "./actions/catalog-actions";
export { CustomGameForm } from "./views/custom-game-form";
export { ExternalSearch } from "./components/external-search";
export { groupExpansions, pickExpansionParent } from "./group-expansions";
export { findExpansionParents } from "./services/expansion-parents";
export { GameCard } from "./components/game-card";
export { GameDetailView } from "./views/game-detail";
export { SearchForm } from "./components/search-form";
export { customGameSchema, parseSearchParams } from "./schemas";
export type { CustomGameInput, SearchParams } from "./schemas";
export {
  getGameDetail,
  getGameForEdit,
  type GameDetail,
} from "./services/game-service";
export type {
  BatchImportResult,
  ExternalSearchResult,
  ImportResult,
  SearchHit,
} from "./services/import-service";
export {
  importExternalGames,
  searchExternalGames,
} from "./services/import-service";
export { searchLocalGames } from "./services/search-service";
export { getGameSource } from "./sources";
export type { GameKind, GameSummary, TermType } from "./types";
