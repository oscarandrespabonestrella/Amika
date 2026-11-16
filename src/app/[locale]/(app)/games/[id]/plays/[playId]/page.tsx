import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getGameDetail } from "@/features/catalog";
import { getPlay, PlayForm } from "@/features/plays";
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
    </div>
  );
}
