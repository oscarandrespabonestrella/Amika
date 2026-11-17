import { ChevronRight, Dices } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { formatMinutes, formatPlayers } from "../format";
import type { GameSummary } from "../types";

type GameCardProps = {
  game: GameSummary;
  /** Extra chips (e.g. library status) rendered after the built-in ones. */
  extra?: ReactNode;
  /** Where the card links to; defaults to the game's detail page. */
  href?: string;
  /** Expansions that hang from this game: folded under the card ("+3 expansions"). */
  expansions?: ReactNode[];
};

export function GameCard({
  game,
  extra,
  href,
  expansions = [],
}: GameCardProps) {
  const t = useTranslations("Games");
  const meta = (
    key: "players" | "playersRange" | "minutes" | "minutesRange",
    values: Record<string, number>,
  ) => t(`meta.${key}`, values);

  const facts = [
    game.yearPublished ? String(game.yearPublished) : null,
    formatPlayers(meta, game.minPlayers, game.maxPlayers),
    formatMinutes(meta, game.minPlaytime, game.maxPlaytime),
  ].filter(Boolean);

  return (
    <li>
      <Link
        href={href ?? `/games/${game.id}`}
        className="flex items-center gap-4 rounded-2xl border border-border bg-card p-3 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-tint text-tint-foreground">
          {game.coverUrl ? (
            // External hotlinked image (BGG): next/image optimization is not applicable.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={game.coverUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <Dices className="size-7" aria-hidden />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-semibold">{game.name}</span>
          {facts.length > 0 && (
            <span className="truncate text-sm text-muted-foreground">
              {facts.join(" · ")}
            </span>
          )}
          <span className="flex flex-wrap gap-1.5">
            {game.kind === "expansion" && (
              <Badge variant="secondary">{t("kind.expansion")}</Badge>
            )}
            {game.isCustom && (
              <Badge variant="outline">{t("badge.custom")}</Badge>
            )}
            {extra}
          </span>
        </span>
      </Link>
      {expansions.length > 0 && (
        <details className="group mt-1 ml-4 rounded-xl border border-border bg-muted/40 px-3 py-1">
          <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground select-none">
            <ChevronRight
              className="size-4 transition-transform group-open:rotate-90"
              aria-hidden
            />
            {t("withExpansions", { count: expansions.length })}
          </summary>
          <ul className="flex flex-col gap-2 pt-1 pb-2">{expansions}</ul>
        </details>
      )}
    </li>
  );
}
