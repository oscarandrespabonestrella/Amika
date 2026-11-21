import { Dices } from "lucide-react";
import { cn } from "@/lib/utils";

/** A game's cover (or a dice placeholder) as a rounded square. */
export function GameThumb({
  coverUrl,
  className,
}: {
  coverUrl: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-13 shrink-0 place-items-center overflow-hidden rounded-xl bg-tint text-tint-foreground",
        className,
      )}
    >
      {coverUrl ? (
        // External hotlinked image (BGG): next/image optimization is not applicable.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      ) : (
        <Dices className="size-1/2" aria-hidden />
      )}
    </span>
  );
}

/** "2–4 · 45′" style meta for a game, from what the catalog knows. */
export function gameMeta(g: {
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlaytime: number | null;
  maxPlaytime: number | null;
}): string {
  const parts: string[] = [];
  if (g.minPlayers !== null || g.maxPlayers !== null) {
    const lo = g.minPlayers ?? g.maxPlayers;
    const hi = g.maxPlayers ?? g.minPlayers;
    parts.push(lo === hi ? `${lo}` : `${lo}–${hi}`);
  }
  const minutes = g.maxPlaytime ?? g.minPlaytime;
  if (minutes !== null) parts.push(`${minutes}′`);
  return parts.join(" · ");
}
