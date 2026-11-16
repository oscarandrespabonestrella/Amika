import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getGameDetail } from "@/features/catalog";
import {
  AdminSheetControls,
  getSheet,
  isAdminViewer,
  listCommunitySheets,
  listSheetFlags,
  SheetEditor,
  SheetView,
} from "@/features/scoring";
import { assertLocale } from "@/i18n/locale";

export default async function SheetPage({
  params,
}: PageProps<"/[locale]/games/[id]/sheets/[sheetId]">) {
  const { locale: rawLocale, id, sheetId } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [game, sheet] = await Promise.all([
    getGameDetail(id, locale),
    getSheet(sheetId),
  ]);
  // Missing, not visible to this user, or opened under the wrong game: all a 404.
  if (!game || !sheet || sheet.gameId !== game.id) notFound();

  if (sheet.ownedByMe) {
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

  // Somebody else's sheet: read-only. Administrators also get moderation controls.
  const [ranked, admin] = await Promise.all([
    listCommunitySheets(game.id),
    isAdminViewer(),
  ]);
  const flags = admin ? await listSheetFlags(sheet.id) : [];
  return (
    <div className="flex flex-col gap-6">
      <SheetView
        gameId={game.id}
        sheet={sheet}
        stats={ranked.find((s) => s.sheetId === sheet.id) ?? null}
      />
      {admin && (
        <AdminSheetControls
          sheetId={sheet.id}
          verified={sheet.verified}
          disabled={sheet.disabled}
          flags={flags}
        />
      )}
    </div>
  );
}
