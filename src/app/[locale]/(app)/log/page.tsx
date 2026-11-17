import { BookMarked } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { GameCard } from "@/features/catalog";
import { parseLibraryFilters, searchLibrary } from "@/features/library";
import { assertLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Entry point of the centre "Log a match" action: pick the game, then fill the play form. */
export default async function LogPage({ params }: PageProps<"/[locale]/log">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const [entries, t] = await Promise.all([
    searchLibrary(parseLibraryFilters({})),
    getTranslations("Log"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      {entries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <GameCard
              key={entry.game.id}
              game={entry.game}
              href={`/games/${entry.game.id}/plays/new`}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-5">
          <EmptyState
            icon={BookMarked}
            title={t("emptyTitle")}
            description={t("emptyBody")}
          />
          <Link
            href="/games"
            className={cn(buttonVariants({ size: "lg" }), "h-11 px-6")}
          >
            {t("browse")}
          </Link>
        </div>
      )}
    </div>
  );
}
