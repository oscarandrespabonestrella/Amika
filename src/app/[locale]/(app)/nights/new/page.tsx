import { getTranslations, setRequestLocale } from "next-intl/server";
import { listGroups } from "@/features/groups";
import {
  getPickerShortlist,
  parsePickerQuery,
  todayIso,
} from "@/features/nights";
import { NightPicker } from "@/features/nights/views/night-picker";
import { assertLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";

export default async function NewNightPage({
  params,
  searchParams,
}: PageProps<"/[locale]/nights/new">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const query = parsePickerQuery(await searchParams);
  const today = todayIso();
  const [t, groups, initial] = await Promise.all([
    getTranslations("Nights"),
    listGroups(),
    getPickerShortlist(query, today),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Link href="/nights" className="text-sm font-medium underline">
        {t("back")}
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("newTitle")}
        </h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>
      <NightPicker
        mode="plan"
        groups={groups}
        initial={initial}
        query={query}
        today={today}
      />
    </div>
  );
}
