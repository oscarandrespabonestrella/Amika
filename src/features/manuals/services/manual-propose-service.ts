import type { PdfVerifier } from "../pdf-verifier";
import { publisherForHost } from "../publishers";
import { isRehostHost } from "../rank";
import { normalizeManualUrl } from "../url-safety";
import type { NewManual } from "./manual-store";

export type ProposeInput = {
  gameId: string;
  url: string;
  title: string;
  locale: string | null;
};

export type ProposeError =
  | "invalid"
  | "already_added"
  | "already_proposed"
  | "not_pdf" // the link is not a PDF (or is too large)
  | "unreachable" // the link did not answer in time
  | "limit"
  | "forbidden";

export type ProposeResult =
  { ok: true; published: boolean } | { ok: false; error: ProposeError };

export type ProposeDeps = {
  verifier: PdfVerifier;
  knownUrls(gameId: string): Promise<{ added: string[]; proposed: string[] }>;
  insertSuggestion(manual: NewManual): Promise<void>;
  /** Administrators only: straight into the Game Center. */
  insertRulesResource(manual: NewManual): Promise<void>;
  isAdmin: boolean;
  now?: () => Date;
};

const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

/**
 * Adds a manual to a game: an administrator publishes it, anyone else proposes it for review.
 * The server re-verifies the PDF itself and derives host, publisher and "official" from the URL;
 * only the title and language come from the browser (they are plain text for the reviewer).
 */
export async function proposeManual(
  deps: ProposeDeps,
  input: ProposeInput,
): Promise<ProposeResult> {
  const url = normalizeManualUrl(input.url);
  if (!url) return { ok: false, error: "invalid" };
  const host = new URL(url).hostname.toLowerCase();
  if (isRehostHost(host)) return { ok: false, error: "invalid" };

  const known = await deps.knownUrls(input.gameId);
  if (known.added.some((u) => normalizeManualUrl(u) === url))
    return { ok: false, error: "already_added" };
  if (known.proposed.some((u) => normalizeManualUrl(u) === url))
    return { ok: false, error: "already_proposed" };

  const check = await deps.verifier.verify(url);
  if (!check.ok) {
    if (check.reason === "unsafe_url") return { ok: false, error: "invalid" };
    if (check.reason === "unreachable" || check.reason === "timeout")
      return { ok: false, error: "unreachable" };
    return { ok: false, error: "not_pdf" };
  }

  const publisher = publisherForHost(host);
  const manual: NewManual = {
    gameId: input.gameId,
    url,
    title: input.title,
    locale: input.locale,
    publisher,
    sourceHost: host,
    isOfficial: publisher !== null,
    sizeBytes: check.sizeBytes,
    verifiedAt: (deps.now?.() ?? new Date()).toISOString(),
  };

  try {
    if (deps.isAdmin) await deps.insertRulesResource(manual);
    else await deps.insertSuggestion(manual);
  } catch (error) {
    const code = pgCode(error);
    if (code === "23505")
      return {
        ok: false,
        error: deps.isAdmin ? "already_added" : "already_proposed",
      };
    if (code === "P0001") return { ok: false, error: "limit" };
    if (code === "42501") return { ok: false, error: "forbidden" };
    throw error;
  }
  return { ok: true, published: deps.isAdmin };
}
