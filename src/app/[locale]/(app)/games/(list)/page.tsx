import { assertLocale } from "@/i18n/locale";
import { Plus, SearchX, Library } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import {
  ExternalSearch,
  findExpansionParents,
  GameCard,
  getGameSource,
  groupExpansions,
  parseSearchParams,
  searchLocalGames,
  SearchForm,
} from "@/features/catalog";
import { BggCollectionImport } from "@/features/library";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export default async function GamesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/games">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const query = parseSearchParams(await searchParams);
  const searching = Boolean(
    query.q || query.kind || query.players || query.time,
  );
  // El catálogo solo muestra juegos cuando alguien busca: sin criterio no hay lista.
  const [games, t] = await Promise.all([
    searching ? searchLocalGames(query) : Promise.resolve([]),
    getTranslations("Games"),
  ]);
  const groups = groupExpansions(games, await findExpansionParents(games));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link
          href="/games/new"
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "h-11",
          )}
        >
          <Plus aria-hidden />
          {t("create")}
        </Link>
      </header>

      <SearchForm params={query} />

      <section aria-label={t("title")} className="flex flex-col gap-3">
        {games.length > 0 ? (
          <>
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {t("results.count", { count: games.length })}
            </p>
            <ul className="flex flex-col gap-2">
              {groups.map(({ item, expansions }) => (
                <GameCard
                  key={item.id}
                  game={item}
                  expansions={expansions.map((e) => (
                    <GameCard key={e.id} game={e} />
                  ))}
                />
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            icon={searching ? SearchX : Library}
            title={t(searching ? "results.emptyTitle" : "results.noneTitle")}
            description={t(
              searching ? "results.emptyBody" : "results.noneBody",
            )}
          />
        )}
      </section>

      <ExternalSearch
        key={query.q}
        query={query.q}
        available={getGameSource().isConfigured()}
      />

      <BggCollectionImport available={getGameSource().isConfigured()} />
    </div>
  );
}
