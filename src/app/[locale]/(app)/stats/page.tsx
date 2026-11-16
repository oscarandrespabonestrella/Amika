import { getTranslations, setRequestLocale } from "next-intl/server";
import { getMyStats } from "@/features/stats";
import { MyStatsView } from "@/features/stats/components/my-stats";
import { assertLocale } from "@/i18n/locale";

export default async function StatsPage({
  params,
}: PageProps<"/[locale]/stats">) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [t, data] = await Promise.all([
    getTranslations("Stats.page"),
    getMyStats(),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>
      <MyStatsView data={data} />
    </div>
  );
}
