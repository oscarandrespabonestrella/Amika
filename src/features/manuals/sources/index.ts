import "server-only";
import { getBraveSearchApiKey } from "@/lib/env/server";
import { createBraveSource } from "./brave/client";
import type { WebSearchSource } from "./web-search-source";

/** The configured web search engine. Swap the adapter here to change provider. */
export function getWebSearchSource(): WebSearchSource {
  return createBraveSource({ apiKey: getBraveSearchApiKey() });
}
