// Pure orchestration (no server-only imports): turns the small signals the browser
// computed (a barcode, title lines) into ranked candidates. Data access is injected so it can be tested; the real
// implementation lives in services/recognition-service.ts.
import { mergeCandidates, type Candidate, type Signal } from "./merge";
import { textSimilarity } from "./text";

export type IdentifyDeps = {
  /** The caller's own learned barcode (RLS: nobody else's). */
  findBarcode(gtin: string): Promise<{ gameId: string; name: string } | null>;
  /** Catalog search (existing `search_games`), best first. */
  searchLocal(line: string): Promise<{ id: string; name: string }[]>;
  /** BoardGameGeek text search through the existing, rate limited source. */
  searchExternal(line: string): Promise<
    | {
        ok: true;
        hits: { externalId: string; name: string; gameId: string | null }[];
      }
    | { ok: false; error: string }
  >;
};

/** What the browser sends (lines may be absent); the action validates it first. */
export type IdentifyRequest = {
  gtin?: string;
  lines?: string[];
};

export type IdentifyOutput = { candidates: Candidate[]; bggLimited: boolean };

/** BGG is asked only when no local title match is at least this similar. */
export const BGG_WEAK_BELOW = 0.6;
/** Each BGG search counts against the user's rate limit: never more than this. */
export const MAX_BGG_SEARCHES = 2;
const LOCAL_PER_LINE = 5;

const LIMITED = new Set(["rate_limited", "unavailable"]);

export async function identifyGame(
  input: IdentifyRequest,
  deps: IdentifyDeps,
): Promise<IdentifyOutput> {
  const signals: Signal[] = [];
  const lines = input.lines ?? [];

  const [barcode, localByLine] = await Promise.all([
    input.gtin ? deps.findBarcode(input.gtin) : Promise.resolve(null),
    Promise.all(
      lines.map(async (line) => ({
        line,
        hits: (await deps.searchLocal(line)).slice(0, LOCAL_PER_LINE),
      })),
    ),
  ]);

  if (barcode)
    signals.push({
      reason: "code",
      gameId: barcode.gameId,
      externalId: null,
      name: barcode.name,
      strength: 1,
    });

  let bestLocal = 0;
  for (const { line, hits } of localByLine)
    for (const hit of hits) {
      const strength = textSimilarity(line, hit.name);
      bestLocal = Math.max(bestLocal, strength);
      signals.push({
        reason: "title",
        gameId: hit.id,
        externalId: null,
        name: hit.name,
        strength,
      });
    }

  let bggLimited = false;
  if (lines.length > 0 && bestLocal < BGG_WEAK_BELOW) {
    for (const line of lines.slice(0, MAX_BGG_SEARCHES)) {
      const result = await deps.searchExternal(line);
      if (!result.ok) {
        if (LIMITED.has(result.error)) {
          bggLimited = true;
          break; // no point asking again
        }
        continue; // any other failure: skip this line quietly
      }
      for (const hit of result.hits)
        signals.push({
          reason: "title",
          gameId: hit.gameId,
          externalId: hit.externalId,
          name: hit.name,
          strength: textSimilarity(line, hit.name),
        });
    }
  }

  return { candidates: mergeCandidates(signals, 5), bggLimited };
}
