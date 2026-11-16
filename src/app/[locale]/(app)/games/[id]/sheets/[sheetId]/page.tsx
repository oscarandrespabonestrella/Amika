import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getGameDetail } from "@/features/catalog";
import { getSheet, SheetEditor } from "@/features/scoring";
import { assertLocale } from "@/i18n/locale";

export default async function EditSheetPage({
  params,
}: PageProps<"/[locale]/games/[id]/sheets/[sheetId]">) {
  const { locale: rawLocale, id, sheetId } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [game, sheet] = await Promise.all([
    getGameDetail(id, locale),
    getSheet(sheetId),
  ]);
  // Missing, someone else's, or opened under the wrong game: all a 404.
  if (!game || !sheet || !sheet.ownedByMe || sheet.gameId !== game.id)
    notFound();
  const t = await getTranslations("Scoring.editor");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("titleEdit")}
      </h1>
      {/* The key remounts the editor with fresh data after a reload (version conflict). */}
      <SheetEditor
        key={`${sheet.id}-${sheet.latestVersion}`}
        gameId={game.id}
        gameName={game.name}
        initial={{
          sheetId: sheet.id,
          title: sheet.title,
          locale: sheet.locale,
          definition: sheet.definition,
          version: sheet.latestVersion,
        }}
      />
    </div>
  );
}
