import { assertLocale } from "@/i18n/locale";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CustomGameForm, getGameForEdit } from "@/features/catalog";

export default async function EditGamePage({
  params,
}: PageProps<"/[locale]/games/[id]/edit">) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // Only the owner's custom games are editable: anything else is a 404.
  const game = await getGameForEdit(id);
  if (!game) notFound();
  const t = await getTranslations("NewGame");

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("editTitle")}
        </h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </header>
      <CustomGameForm edit={game} />
    </div>
  );
}
