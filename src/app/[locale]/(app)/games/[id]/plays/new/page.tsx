import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getGameDetail } from "@/features/catalog";
import { listPlayers } from "@/features/players";
import { getPlayDefaults, PlayForm } from "@/features/plays";
import { listSheetOptions } from "@/features/scoring";
import { assertLocale } from "@/i18n/locale";

export default async function NewPlayPage({
  params,
}: PageProps<"/[locale]/games/[id]/plays/new">) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [game, sheets, roster] = await Promise.all([
    getGameDetail(id, locale),
    listSheetOptions(id),
    listPlayers(),
  ]);
  if (!game) notFound(); // missing, or a private game that is not yours
  const defaults = await getPlayDefaults(id, sheets);
  const t = await getTranslations("Plays.form");

  const expansions = game.relations
    .filter((r) => r.type === "has_expansion" && r.gameId !== null)
    .map((r) => ({ id: r.gameId!, name: r.name }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t("titleNew")}</h1>
      <PlayForm
        gameId={game.id}
        gameName={game.name}
        sheets={sheets}
        defaultSheetId={defaults.defaultSheetId}
        expansions={expansions}
        roster={roster}
      />
    </div>
  );
}
