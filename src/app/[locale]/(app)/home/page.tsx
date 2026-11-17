import { assertLocale } from "@/i18n/locale";
import { BookMarked, Dices, Library } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import {
  countLibrary,
  parseLibraryFilters,
  searchLibrary,
} from "@/features/library";
import { getOrCreateProfile } from "@/features/profiles";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export default async function HomePage({
  params,
}: PageProps<"/[locale]/home">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const [t, profile, libraryCount, shelf] = await Promise.all([
    getTranslations("Home"),
    getOrCreateProfile(),
    countLibrary(),
    searchLibrary(parseLibraryFilters({})),
  ]);
  const recent = shelf.slice(0, 8);
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

      {recent.length > 0 && (
        <section aria-label={t("libraryTitle")} className="flex flex-col gap-3">
          <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {recent.map(({ game }) => (
              <li key={game.id} className="w-24 shrink-0">
                <Link
                  href={`/games/${game.id}`}
                  className="flex flex-col gap-2 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="grid size-24 place-items-center overflow-hidden rounded-2xl bg-tint text-tint-foreground">
                    {game.coverUrl ? (
                      // External hotlinked image (BGG): next/image optimization is not applicable.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={game.coverUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="size-full object-cover"
                      />
                    ) : (
                      <Dices className="size-8" aria-hidden />
                    )}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {game.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
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
