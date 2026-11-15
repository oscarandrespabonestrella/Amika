const ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
]);

const ID_IN_PATH = new Set(["embed", "shorts", "live", "v"]);

/**
 * Extracts the 11-character video id from a YouTube URL (or accepts a bare id).
 * Anything that is not clearly YouTube returns null: we never store or embed
 * arbitrary URLs, only the id, and the player URL is built from it.
 */
export function parseYoutubeId(input: string): string | null {
  const text = input.trim();
  if (ID.test(text)) return text;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  let candidate: string | null = null;

  if (url.hostname.toLowerCase() === "youtu.be") {
    candidate = parts[0] ?? null;
  } else if (parts[0] === "watch") {
    candidate = url.searchParams.get("v");
  } else if (parts[0] && ID_IN_PATH.has(parts[0])) {
    candidate = parts[1] ?? null;
  }
  return candidate && ID.test(candidate) ? candidate : null;
}

/** The only URL we ever embed. `youtube-nocookie.com` sets no cookies until playback. */
export function youtubeEmbedUrl(id: string): string {
  if (!ID.test(id)) throw new Error("invalid youtube id");
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1`;
}
