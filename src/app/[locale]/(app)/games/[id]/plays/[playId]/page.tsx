import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getGameDetail } from "@/features/catalog";
import { getPlay, PlayForm } from "@/features/plays";
import { getMyVote, getSheet, SheetVote } from "@/features/scoring";
import { assertLocale } from "@/i18n/locale";

export default async function EditPlayPage({
  params,
}: PageProps<"/[locale]/games/[id]/plays/[playId]">) {
  const { locale: rawLocale, id, playId } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [game, play] = await Promise.all([
    getGameDetail(id, locale),
    getPlay(playId),
  ]);
  // Missing, someone else's, or opened under the wrong game: all a 404.
  if (!game || !play || play.gameId !== game.id) notFound();
  const t = await getTranslations("Plays.form");

  // Somebody else's sheet: offer the thumbs up / report prompt (one vote per sheet version).
  const sheet = play.sheet ? await getSheet(play.sheet.sheetId) : null;
  const canVote = play.sheet !== null && sheet !== null && !sheet.ownedByMe;
  const myVote =
    canVote && play.sheet ? await getMyVote(play.sheet.versionId) : null;

  const expansions = game.relations
    .filter((r) => r.type === "has_expansion" && r.gameId !== null)
    .map((r) => ({ id: r.gameId!, name: r.name }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("titleEdit")}
      </h1>
      <PlayForm
        key={play.id}
        gameId={game.id}
        gameName={game.name}
        sheets={[]}
        defaultSheetId={null}
        expansions={expansions}
        initial={play}
      />
      {canVote && play.sheet && (
        <SheetVote
          versionId={play.sheet.versionId}
          playId={play.id}
          current={myVote}
        />
      )}
    </div>
  );
}
