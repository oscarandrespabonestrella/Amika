import { ArrowLeft, Dices, ExternalLink, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { formatMinutes, formatPlayers } from "../format";
import type { GameDetail } from "../services/game-service";
import { TERM_TYPES } from "../types";
import { ExpansionsList, type ExpansionItem } from "./expansions-list";
import { GameTabs } from "./game-tabs";
import { ImportRelationButton } from "./import-relation-button";
import { OwnerActions } from "./owner-actions";
import { PhotoGallery } from "./photo-gallery";

type Props = {
  game: GameDetail;
  /** Slot for the user's library controls (owned by the library module). */
  libraryPanel?: ReactNode;
  /** Slot for rules, videos, FAQ and gallery (owned by the game-center module). */
  gameCenter?: ReactNode;
  /** Slot for the user's score sheets (owned by the scoring module). */
  scoringPanel?: ReactNode;
  /** Slot for the user's matches of this game (owned by the plays module). */
  playsPanel?: ReactNode;
  /** Slot for the user's statistics of this game (owned by the stats module). */
  statsPanel?: ReactNode;
  /** Whether adding a game from the external source is possible right now. */
  bggAvailable?: boolean;
  /** Counts shown on the tabs. */
  matchCount?: number;
  sheetCount?: number;
  /** Ids of the games the user has in their library (to mark owned expansions). */
  ownedGameIds?: readonly string[];
  /** Tab to open, from `?tab=`. */
  initialTab?: string;
};

export function GameDetailView({
  game,
  libraryPanel,
  gameCenter,
  scoringPanel,
  playsPanel,
  statsPanel,
  bggAvailable = false,
  matchCount = 0,
  sheetCount = 0,
  ownedGameIds = [],
  initialTab,
}: Props) {
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

  const designers = game.terms
    .filter((term) => term.type === "designer")
    .map((term) => term.name);
  const subtitle = [
    designers.slice(0, 2).join(", ") || null,
    game.yearPublished ? String(game.yearPublished) : null,
    tg(game.kind === "expansion" ? "kind.expansion" : "kind.base"),
  ]
    .filter(Boolean)
    .join(" · ");
  const strip = facts.filter((fact) => fact.label !== t("year"));

  const owned = new Set(ownedGameIds);
  const expansionItems: ExpansionItem[] = game.relations
    .filter((relation) => relation.type === "has_expansion")
    .map((relation) => ({
      key: `${relation.gameId ?? relation.externalId ?? relation.name}`,
      name: relation.name,
      gameId: relation.gameId,
      externalId: relation.externalId,
      owned: relation.gameId !== null && owned.has(relation.gameId),
    }));

  const overview = (
    <>
      {/* Only the owner can see a custom game, so "custom" implies "yours". */}
      {game.isCustom && <OwnerActions gameId={game.id} />}
      {libraryPanel}
      {statsPanel}

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

      {(["expansion_of"] as const).map((type) => {
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
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span>
                        {relation.name}{" "}
                        <span className="text-sm text-muted-foreground">
                          ({t("notInCatalog")})
                        </span>
                      </span>
                      {relation.externalId && (
                        <ImportRelationButton
                          externalId={relation.externalId}
                          available={bggAvailable}
                        />
                      )}
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

      {gameCenter}

      <PhotoGallery
        gameId={game.id}
        gameName={game.name}
        photos={game.photos}
      />
    </>
  );

  const tabs = [
    { id: "overview", label: t("tabs.overview"), content: overview },
    {
      id: "matches",
      label: t("tabs.matches"),
      count: matchCount,
      content: playsPanel,
    },
    ...(game.kind === "base" || expansionItems.length > 0
      ? [
          {
            id: "expansions",
            label: t("tabs.expansions"),
            count: expansionItems.length,
            content: (
              <section
                aria-label={t("relations.has_expansion")}
                className="flex flex-col gap-3"
              >
                <ExpansionsList
                  items={expansionItems}
                  bggAvailable={bggAvailable}
                />
              </section>
            ),
          },
        ]
      : []),
    {
      id: "sheets",
      label: t("tabs.sheets"),
      count: sheetCount,
      content: scoringPanel,
    },
  ];

  return (
    <article className="flex flex-col gap-6">
      <header className="-mx-4 -mt-6 flex flex-col items-center gap-4 md:mx-0 md:mt-0">
        <div className="relative flex w-full justify-center overflow-hidden px-4 pt-14 pb-2 md:rounded-3xl">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-tint [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
          >
            {cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                referrerPolicy="no-referrer"
                className="size-full scale-125 object-cover opacity-50 blur-2xl"
              />
            )}
          </div>
          <Link
            href="/games"
            aria-label={t("back")}
            className="absolute top-3 left-3 grid size-11 place-items-center rounded-full bg-background/70 text-foreground backdrop-blur outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <div className="grid aspect-square w-40 place-items-center overflow-hidden rounded-2xl bg-tint text-tint-foreground shadow-2xl shadow-black/40">
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
        </div>

        <div className="flex flex-col items-center gap-1 px-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-balance">
            {game.name}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          {game.isCustom && (
            <Badge variant="outline" className="mt-1">
              {tg("badge.custom")}
            </Badge>
          )}
        </div>

        {strip.length > 0 && (
          <dl
            className="mx-4 grid w-[calc(100%-2rem)] max-w-xl divide-x divide-border overflow-hidden rounded-2xl border border-border bg-card text-center"
            style={{
              gridTemplateColumns: `repeat(${strip.length}, minmax(0, 1fr))`,
            }}
          >
            {strip.map((fact) => (
              <div key={fact.label} className="flex flex-col-reverse px-2 py-3">
                <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      <GameTabs tabs={tabs} label={game.name} initialTab={initialTab} />

      {/* Stays in reach while browsing the tabs; on a phone it rides above the bottom navigation. */}
      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-2xl md:border">
        <Link
          href={`/games/${game.id}/plays/new`}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Plus className="size-5" aria-hidden />
          {t("logMatch")}
        </Link>
      </div>
    </article>
  );
}
