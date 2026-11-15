import { assertLocale } from "@/i18n/locale";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CustomGameForm } from "@/features/catalog";

export default async function NewGamePage({
  params,
}: PageProps<"/[locale]/games/new">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("NewGame");

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </header>
      <CustomGameForm />
    </div>
  );
}
