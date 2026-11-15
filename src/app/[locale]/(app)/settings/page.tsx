import { assertLocale } from "@/i18n/locale";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { LocaleSelect, ThemeSelect } from "@/features/preferences";

export default async function SettingsPage({
  params,
}: PageProps<"/[locale]/settings">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);
  return <Settings />;
}

function Settings() {
  const t = useTranslations("Settings");
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="font-semibold">{t("appearance")}</h2>
          <p className="text-sm text-muted-foreground">{t("appearanceHint")}</p>
        </div>
        <ThemeSelect />
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="font-semibold">{t("language")}</h2>
          <p className="text-sm text-muted-foreground">{t("languageHint")}</p>
        </div>
        <LocaleSelect />
      </section>
    </div>
  );
}
