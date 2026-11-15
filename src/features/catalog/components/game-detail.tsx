import { ArrowLeft, Dices, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { formatMinutes, formatPlayers } from "../format";
import type { GameDetail } from "../services/game-service";
import { TERM_TYPES } from "../types";
import { OwnerActions } from "./owner-actions";
import { PhotoGallery } from "./photo-gallery";

type Props = {
  game: GameDetail;
  /** Slot for the user's library controls (owned by the library module). */
  libraryPanel?: ReactNode;
};

export function GameDetailView({ game, libraryPanel }: Props) {
  const t = useTranslations("Game");
  const tg = useTranslations("Games");
  const meta = (
    key: "players" | "playersRange" | "minutes" | "minutesRange",
    values: Record<string, number>,
  ) => tg(`meta.${key}`, values);

  const facts = [
    {
      label: t("year"),
      value: game.yearPublished ? String(game.yearPublished) : null,
    },
    {
      label: t("players"),
      value: formatPlayers(meta, game.minPlayers, game.maxPlayers),
    },
    {
      label: t("playtime"),
      value: formatMinutes(meta, game.minPlaytime, game.maxPlaytime),
    },
    {
      label: t("minAge"),
      value: game.minAge ? t("ageValue", { age: game.minAge }) : null,
    },
  ].filter(
    (fact): fact is { label: string; value: string } => fact.value !== null,
  );

  // The user's own photo is the best cover; otherwise the linked BGG image.
  const cover = game.photos.find((p) => p.url)?.url ?? game.coverUrl;

  return (
    <article className="flex flex-col gap-8">
      <Link
        href="/games"
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>

      <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="grid aspect-square w-full max-w-48 shrink-0 place-items-center overflow-hidden rounded-2xl bg-accent text-accent-foreground">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt={t("coverAlt", { name: game.name })}
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <Dices className="size-14" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            {game.name}
          </h1>
          <div className="flex flex-wrap gap-1.5">
            {game.kind === "expansion" && (
              <Badge variant="secondary">{tg("kind.expansion")}</Badge>
            )}
            {game.isCustom && (
              <Badge variant="outline">{tg("badge.custom")}</Badge>
            )}
          </div>
          {facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-xs text-muted-foreground">
                    {fact.label}
                  </dt>
                  <dd className="font-medium">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </header>

      {/* Only the owner can see a custom game, so "custom" implies "yours". */}
      {game.isCustom && <OwnerActions gameId={game.id} />}
      {libraryPanel}

      <section
        aria-labelledby="description-title"
        className="flex flex-col gap-2"
      >
        <h2
          id="description-title"
          className="text-lg font-semibold tracking-tight"
        >
          {t("description")}
        </h2>
        {game.description ? (
          // Plain text only (never HTML): React escapes it, newlines are preserved.
          <p className="max-w-prose text-pretty whitespace-pre-line">
            {game.description}
          </p>
        ) : (
          <p className="text-muted-foreground">{t("noDescription")}</p>
        )}
      </section>

      {TERM_TYPES.map((type) => {
        const items = game.terms.filter((term) => term.type === type);
        if (items.length === 0) return null;
        return (
          <section
            key={type}
            aria-label={t(`terms.${type}`)}
            className="flex flex-col gap-2"
          >
            <h2 className="text-sm font-medium text-muted-foreground">
              {t(`terms.${type}`)}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {items.map((term) => (
                <li key={`${type}-${term.name}`}>
                  <Badge variant="outline" className="h-6 px-2.5 text-sm">
                    {term.name}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {(["has_expansion", "expansion_of"] as const).map((type) => {
        const items = game.relations.filter(
          (relation) => relation.type === type,
        );
        if (items.length === 0) return null;
        return (
          <section
            key={type}
            aria-label={t(`relations.${type}`)}
            className="flex flex-col gap-2"
          >
            <h2 className="text-lg font-semibold tracking-tight">
              {t(`relations.${type}`)}
            </h2>
            <ul className="flex flex-col gap-1.5">
              {items.map((relation) => (
                <li key={`${type}-${relation.externalId ?? relation.name}`}>
                  {relation.gameId ? (
                    <Link
                      href={`/games/${relation.gameId}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {relation.name}
                    </Link>
                  ) : (
                    <span>
                      {relation.name}{" "}
                      <span className="text-sm text-muted-foreground">
                        ({t("notInCatalog")})
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {game.bggUrl && (
        <p className="flex flex-col gap-1 text-sm">
          <a
            href={game.bggUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-primary underline-offset-4 hover:underline"
          >
            {t("viewOnBgg")}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <span className="text-muted-foreground">{t("attribution")}</span>
        </p>
      )}

      <PhotoGallery
        gameId={game.id}
        gameName={game.name}
        photos={game.photos}
      />
    </article>
  );
}
