import { assertLocale } from "@/i18n/locale";
import { BookMarked, SearchX, Star } from "lucide-react";
import Form from "next/form";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GameCard } from "@/features/catalog";
import {
  LibraryBadges,
  parseLibraryFilters,
  searchLibrary,
  type LibraryFilters,
} from "@/features/library";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Builds a /library URL keeping the search text and changing one filter. */
function href(filters: LibraryFilters, change: Partial<LibraryFilters>) {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status) params.set("status", next.status);
  if (next.favorites) params.set("favorites", "1");
  const query = params.toString();
  return query ? `/library?${query}` : "/library";
}

export default async function LibraryPage({
  params,
  searchParams,
}: PageProps<"/[locale]/library">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const filters = parseLibraryFilters(await searchParams);
  const [entries, t] = await Promise.all([
    searchLibrary(filters),
    getTranslations("Library"),
  ]);
  const filtering = Boolean(filters.q || filters.status || filters.favorites);

  const chips = [
    {
      label: t("filters.all"),
      active: !filters.status,
      to: href(filters, { status: undefined }),
    },
    {
      label: t("filters.owned"),
      active: filters.status === "owned",
      to: href(filters, { status: "owned" }),
    },
    {
      label: t("filters.previouslyOwned"),
      active: filters.status === "previously_owned",
      to: href(filters, { status: "previously_owned" }),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      <Form action={`/${locale}/library`} role="search" className="flex gap-2">
        {filters.status && (
          <input type="hidden" name="status" value={filters.status} />
        )}
        {filters.favorites && (
          <input type="hidden" name="favorites" value="1" />
        )}
        <Input
          name="q"
          type="search"
          defaultValue={filters.q}
          maxLength={100}
          aria-label={t("search.label")}
          placeholder={t("search.placeholder")}
          className="h-11 flex-1"
        />
        <Button type="submit" size="lg" className="h-11 px-5">
          {t("search.submit")}
        </Button>
      </Form>

      <nav aria-label={t("filters.label")} className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <Link
            key={chip.label}
            href={chip.to}
            aria-current={chip.active ? "true" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              chip.active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {chip.label}
          </Link>
        ))}
        <Link
          href={href(filters, { favorites: !filters.favorites })}
          aria-current={filters.favorites ? "true" : undefined}
          className={cn(
            "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            filters.favorites
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Star
            className={cn("size-4", filters.favorites && "fill-current")}
            aria-hidden
          />
          {t("filters.favorites")}
        </Link>
      </nav>

      {entries.length > 0 ? (
        <section aria-label={t("title")} className="flex flex-col gap-3">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {t("count", { count: entries.length })}
          </p>
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <GameCard
                key={entry.game.id}
                game={entry.game}
                extra={
                  <LibraryBadges
                    status={entry.status}
                    isFavorite={entry.isFavorite}
                    rating={entry.rating}
                  />
                }
              />
            ))}
          </ul>
        </section>
      ) : (
        <div className="flex flex-col items-center gap-5">
          <EmptyState
            icon={filtering ? SearchX : BookMarked}
            title={t(filtering ? "noMatchTitle" : "emptyTitle")}
            description={t(filtering ? "noMatchBody" : "emptyBody")}
          />
          {!filtering && (
            <Link
              href="/games"
              className={cn(buttonVariants({ size: "lg" }), "h-11 px-6")}
            >
              {t("browse")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
