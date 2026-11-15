import "server-only";
import { getBggApiToken } from "@/lib/env/server";
import type { GameSource } from "./game-source";
import { createBggSource } from "./bgg/client";

/** The configured external source (BoardGameGeek). Server only: it holds the token. */
export function getGameSource(): GameSource {
  return createBggSource({ token: getBggApiToken() });
}

export type { GameSource } from "./game-source";
