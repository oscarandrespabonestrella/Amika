import type { GameSource } from "../game-source";
import { BggError } from "./errors";
import { parseSearchResponse, parseThingResponse } from "./parse";

/**
 * BoardGameGeek XML API2 client.
 *
 * UNVERIFIED until the API token is approved: the base URL, the
 * `Authorization: Bearer` header and the 202/429 behaviour follow BGG's public
 * documentation as we know it. Everything BGG-specific lives in this file and
 * `parse.ts`, so a correction is a one-place change (see bgg.contract.test.ts).
 */

const BASE_URL = "https://boardgamegeek.com/xmlapi2";
const TIMEOUT_MS = 10_000;
const MAX_QUEUE_RETRIES = 3; // BGG answers 202 while it builds a response
const USER_AGENT = "Amika/1.0 (personal, non-commercial project)";

type Options = {
  token: string | undefined;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createBggSource({
  token,
  fetchImpl = fetch,
  sleep = defaultSleep,
}: Options): GameSource {
  async function get(
    path: string,
    params: Record<string, string>,
  ): Promise<string> {
    if (!token) throw new BggError("not_configured");

    const url = new URL(`${BASE_URL}/${path}`);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/xml",
            "User-Agent": USER_AGENT,
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: "error", // never follow a redirect off boardgamegeek.com
          cache: "no-store",
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
          throw new BggError("timeout");
        }
        throw new BggError("upstream", "network error");
      }

      if (response.status === 202) {
        if (attempt >= MAX_QUEUE_RETRIES)
          throw new BggError("timeout", "BGG kept the request queued");
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (response.status === 401 || response.status === 403)
        throw new BggError("unauthorized");
      if (response.status === 429) throw new BggError("rate_limited");
      if (!response.ok)
        throw new BggError("upstream", `HTTP ${response.status}`);

      return response.text();
    }
  }

  return {
    id: "bgg",
    isConfigured: () => Boolean(token),

    async search(query) {
      const q = query.trim().slice(0, 100);
      if (q.length < 2) return [];
      const xml = await get("search", {
        query: q,
        type: "boardgame,boardgameexpansion",
      });
      return parseSearchResponse(xml).slice(0, 25);
    },

    async fetchGame(externalId) {
      if (!/^\d{1,9}$/.test(externalId)) throw new BggError("not_found");
      const xml = await get("thing", { id: externalId, stats: "0" });
      return parseThingResponse(xml);
    },
  };
}
