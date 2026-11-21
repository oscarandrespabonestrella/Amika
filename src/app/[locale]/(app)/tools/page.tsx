import { getTranslations, setRequestLocale } from "next-intl/server";
import { ToolsHub } from "@/features/tools";
import { assertLocale } from "@/i18n/locale";

export default async function ToolsPage({
  params,
}: PageProps<"/[locale]/tools">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const t = await getTranslations("Tools");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>
      <ToolsHub />
    </div>
  );
}
