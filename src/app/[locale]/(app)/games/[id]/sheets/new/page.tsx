import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getGameDetail } from "@/features/catalog";
import { SheetEditor } from "@/features/scoring";
import { assertLocale } from "@/i18n/locale";

export default async function NewSheetPage({
  params,
}: PageProps<"/[locale]/games/[id]/sheets/new">) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const game = await getGameDetail(id, locale);
  if (!game) notFound();
  const t = await getTranslations("Scoring.editor");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t("titleNew")}</h1>
      <SheetEditor gameId={game.id} gameName={game.name} />
    </div>
  );
}
