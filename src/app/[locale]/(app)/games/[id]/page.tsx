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
import { getLibraryItem, LibraryPanel } from "@/features/library";
import { listPlaysForGame, PlaysPanel } from "@/features/plays";
import { listSheetsForGame, SheetsLink } from "@/features/scoring";

export default async function GamePage({
  params,
}: PageProps<"/[locale]/games/[id]">) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const { userId } = await auth();
  const [game, item, sheets, plays] = await Promise.all([
    getGameDetail(id, locale),
    getLibraryItem(id),
    listSheetsForGame(id),
    listPlaysForGame(id),
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
      libraryPanel={<LibraryPanel gameId={game.id} item={item} />}
      gameCenter={center && <GameCenter gameId={game.id} data={center} />}
      scoringPanel={<SheetsLink gameId={game.id} count={sheets.length} />}
      playsPanel={<PlaysPanel gameId={game.id} plays={plays} />}
    />
  );
}
