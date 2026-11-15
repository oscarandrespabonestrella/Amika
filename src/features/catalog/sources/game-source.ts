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
}
