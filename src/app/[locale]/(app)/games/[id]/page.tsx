import { assertLocale } from "@/i18n/locale";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  GameDetailView,
  getGameDetail,
  getGameSource,
} from "@/features/catalog";
import { GameCenter, getGameCenter } from "@/features/game-center";
import {
  getLibraryItem,
  LibraryPanel,
  parseLibraryFilters,
  searchLibrary,
} from "@/features/library";
import { saveLibraryItemAction } from "@/features/library/actions/library-actions";
import { listPlaysForGame, PlaysPanel } from "@/features/plays";
import {
  GameStatsPanel,
  getGameCategoryStats,
  getGameStats,
} from "@/features/stats";
import { listSheetsForGame, SheetsLink } from "@/features/scoring";

/** "Add" on an expansion puts it straight into the library as owned. */
async function ownImportedExpansion(gameId: string) {
  "use server";
  return saveLibraryItemAction({ gameId, status: "owned" });
}

export default async function GamePage({
  params,
  searchParams,
}: PageProps<"/[locale]/games/[id]">) {
  const { locale: rawLocale, id } = await params;
  const tab = (await searchParams).tab;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const { userId } = await auth();
  const [game, item, sheets, plays, stats, categories, library] =
    await Promise.all([
      getGameDetail(id, locale),
      getLibraryItem(id),
      listSheetsForGame(id),
      listPlaysForGame(id),
      getGameStats(id),
      getGameCategoryStats(id),
      searchLibrary(parseLibraryFilters({})),
    ]);
  if (!game) notFound();

  // Game Center content exists only for catalog games, never for private custom ones.
  const center =
    !game.isCustom && userId
      ? await getGameCenter(game.id, locale, userId)
      : null;

  return (
    <GameDetailView
      game={game}
      bggAvailable={getGameSource().isConfigured()}
      initialTab={typeof tab === "string" ? tab : undefined}
      matchCount={plays.length}
      sheetCount={sheets.length}
      ownedGameIds={library.map((entry) => entry.game.id)}
      onExpansionImported={ownImportedExpansion}
      libraryPanel={<LibraryPanel gameId={game.id} item={item} />}
      gameCenter={center && <GameCenter gameId={game.id} data={center} />}
      scoringPanel={<SheetsLink gameId={game.id} count={sheets.length} />}
      playsPanel={<PlaysPanel gameId={game.id} plays={plays} />}
      statsPanel={<GameStatsPanel data={stats} categories={categories} />}
    />
  );
}
