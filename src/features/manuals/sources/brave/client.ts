import { z } from "zod";
import { WebSearchError, type WebSearchSource } from "../web-search-source";
import type { WebResult } from "../../types";

/**
 * Brave Search API (web search) client.
 * Docs: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
 * `GET /res/v1/web/search?q=…&count=…&search_lang=…&country=…` with the key in the
 * `X-Subscription-Token` header. Everything Brave-specific lives in this file.
 */

const BASE_URL = "https://api.search.brave.com/res/v1/web/search";
const TIMEOUT_MS = 10_000;
const MAX_QUERY_CHARS = 300; // the API accepts 400 chars / 50 words
const MAX_COUNT = 20;

const hitSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
  language: z.string().optional(),
});

// Validate the envelope strictly but each hit on its own: one odd hit must not sink the rest.
const responseSchema = z.object({
  web: z.object({ results: z.array(z.unknown()) }).optional(),
});

type Options = {
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
};

export function createBraveSource({
  apiKey,
  fetchImpl = fetch,
}: Options): WebSearchSource {
  return {
    id: "brave",
    isConfigured: () => Boolean(apiKey),

    async search(query, { lang, country, count = 10 }) {
      if (!apiKey) throw new WebSearchError("not_configured");

      const url = new URL(BASE_URL);
      url.searchParams.set("q", query.trim().slice(0, MAX_QUERY_CHARS));
      url.searchParams.set(
        "count",
        String(Math.min(Math.max(count, 1), MAX_COUNT)),
      );
      url.searchParams.set("search_lang", lang);
      if (country) url.searchParams.set("country", country);
      url.searchParams.set("safesearch", "moderate");

      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            "X-Subscription-Token": apiKey,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: "error",
          cache: "no-store",
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError")
          throw new WebSearchError("timeout");
        throw new WebSearchError("upstream", "network error");
      }

      if (response.status === 401 || response.status === 403)
        throw new WebSearchError("unauthorized");
      if (response.status === 429) throw new WebSearchError("rate_limited");
      if (!response.ok)
        throw new WebSearchError("upstream", `HTTP ${response.status}`);

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new WebSearchError("invalid_response", "not JSON");
      }
      const envelope = responseSchema.safeParse(json);
      if (!envelope.success)
        throw new WebSearchError("invalid_response", "unexpected shape");

      const out: WebResult[] = [];
      for (const raw of envelope.data.web?.results ?? []) {
        const hit = hitSchema.safeParse(raw);
        if (!hit.success) continue;
        out.push({
          url: hit.data.url,
          title: hit.data.title,
          description: hit.data.description ?? "",
          language: hit.data.language ?? null,
        });
      }
      return out;
    },
  };
}
