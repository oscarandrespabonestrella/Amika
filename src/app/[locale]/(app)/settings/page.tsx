import { assertLocale } from "@/i18n/locale";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSelect, ThemeSelect } from "@/features/preferences";
import { DisplayNameForm, getOrCreateProfile } from "@/features/profiles";
import { RecognitionSettings } from "@/features/recognition/components/recognition-settings";
import { Link } from "@/i18n/navigation";

export default async function SettingsPage({
  params,
}: PageProps<"/[locale]/settings">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const [t, tp, profile] = await Promise.all([
    getTranslations("Settings"),
    getTranslations("Players.settings"),
    getOrCreateProfile(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="font-semibold">{t("profile.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("profile.hint")}</p>
        </div>
        <DisplayNameForm initialName={profile?.display_name ?? ""} />
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="font-semibold">{tp("title")}</h2>
          <p className="text-sm text-muted-foreground">{tp("hint")}</p>
        </div>
        <Link
          href="/players"
          className="inline-flex h-11 w-fit items-center rounded-lg border border-border bg-background px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {tp("open")}
        </Link>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="font-semibold">{t("appearance")}</h2>
          <p className="text-sm text-muted-foreground">{t("appearanceHint")}</p>
        </div>
        <ThemeSelect />
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="font-semibold">{t("recognition.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("recognition.hint")}
          </p>
        </div>
        <RecognitionSettings />
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
