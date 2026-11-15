import { assertLocale } from "@/i18n/locale";
import { BookMarked, Library } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { countLibrary } from "@/features/library";
import { getOrCreateProfile } from "@/features/profiles";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export default async function HomePage({
  params,
}: PageProps<"/[locale]/home">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const [t, profile, libraryCount] = await Promise.all([
    getTranslations("Home"),
    getOrCreateProfile(),
    countLibrary(),
  ]);
  const name = profile?.display_name.trim();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {name ? t("titleNamed", { name }) : t("title")}
      </h1>

      {libraryCount > 0 ? (
        <section
          aria-labelledby="library-summary"
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
        >
          <h2
            id="library-summary"
            className="flex items-center gap-2 font-semibold"
          >
            <BookMarked className="size-5 text-primary" aria-hidden />
            {t("libraryTitle")}
          </h2>
          <p className="text-muted-foreground">
            {t("libraryCount", { count: libraryCount })}
          </p>
          <Link
            href="/library"
            className={cn(buttonVariants({ size: "lg" }), "h-11 w-fit px-6")}
          >
            {t("openLibrary")}
          </Link>
        </section>
      ) : (
        <EmptyState
          icon={Library}
          title={t("emptyTitle")}
          description={t("emptyBody")}
        />
      )}

      <Link
        href="/games"
        className={cn(
          buttonVariants({
            size: "lg",
            variant: libraryCount > 0 ? "outline" : "default",
          }),
          "h-11 w-fit px-6",
        )}
      >
        {t("browse")}
      </Link>
    </div>
  );
}
