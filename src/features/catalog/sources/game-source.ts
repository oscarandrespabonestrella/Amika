import type { ExternalGame, ExternalSearchHit, ExternalSource } from "../types";

/**
 * Port for an external catalog (BoardGameGeek today). The rest of the app only
 * knows this interface, so another source can be added without touching it.
 */
export interface GameSource {
  readonly id: ExternalSource;
  /** False when credentials are missing (e.g. the BGG token is still pending). */
  isConfigured(): boolean;
  search(query: string): Promise<ExternalSearchHit[]>;
  fetchGame(externalId: string): Promise<ExternalGame>;
  /**
   * Up to MAX_BATCH games in ONE upstream call. Ids the source does not return (or
   * returns malformed) are simply absent from the result.
   */
  fetchGames(externalIds: string[]): Promise<ExternalGame[]>;
}

/** BGG's `thing` endpoint accepts at most 20 ids per request. */
export const MAX_BATCH = 20;
