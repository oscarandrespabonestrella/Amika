// Client-safe exports of the players module: pure code and types only (the main index
// also exports server-only services, which a client component must not import).
export { normalizePlayerName } from "./normalize";
export { PLAYER_NAME_MAX } from "./schemas";
export type { Player } from "./services/player-service";
