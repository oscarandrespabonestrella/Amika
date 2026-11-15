import { assertLocale } from "@/i18n/locale";
import { Library } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { getOrCreateProfile } from "@/features/profiles";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export default async function HomePage({
  params,
}: PageProps<"/[locale]/home">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const [t, profile] = await Promise.all([
    getTranslations("Home"),
    getOrCreateProfile(),
  ]);
  const name = profile?.display_name.trim();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {name ? t("titleNamed", { name }) : t("title")}
      </h1>
      <EmptyState
        icon={Library}
        title={t("emptyTitle")}
        description={t("emptyBody")}
      />
      <Link
        href="/games"
        className={cn(buttonVariants({ size: "lg" }), "h-11 w-fit px-6")}
      >
        {t("browse")}
      </Link>
    </div>
  );
}
