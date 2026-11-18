import { assertLocale } from "@/i18n/locale";
import { BookMarked, SearchX, SlidersHorizontal, Star } from "lucide-react";
import Form from "next/form";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DragScroll } from "@/components/drag-scroll";
import { EmptyState } from "@/components/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  findExpansionParents,
  GameCard,
  groupExpansions,
} from "@/features/catalog";
import {
  LibraryBadges,
  getLibraryCounts,
  listLibraryTerms,
  parseLibraryFilters,
  searchLibrary,
  type LibraryFilters,
} from "@/features/library";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const chipClass =
  "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const chipOn = "border-foreground bg-foreground font-semibold text-background";
const chipOff =
  "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground";

/** Builds a /library URL keeping the search text and changing one filter. */
function href(filters: LibraryFilters, change: Partial<LibraryFilters>) {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status) params.set("status", next.status);
  if (next.favorites) params.set("favorites", "1");
  if (next.players) params.set("players", String(next.players));
  if (next.time) params.set("time", String(next.time));
  if (next.category) params.set("category", next.category);
  if (next.mechanic) params.set("mechanic", next.mechanic);
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
  const [entries, terms, counts, t] = await Promise.all([
    searchLibrary(filters),
    listLibraryTerms(locale),
    getLibraryCounts(),
    getTranslations("Library"),
  ]);
  const groups = groupExpansions(
    entries.map((entry) => ({
      ...entry,
      id: entry.game.id,
      kind: entry.game.kind,
    })),
    await findExpansionParents(entries.map((entry) => entry.game)),
  );
  const advanced = Boolean(
    filters.players || filters.time || filters.category || filters.mechanic,
  );
  const filtering = Boolean(
    filters.q || filters.status || filters.favorites || advanced,
  );

  const chips = [
    {
      label: t("filters.all"),
      count: counts.all,
      active: !filters.status,
      to: href(filters, { status: undefined }),
    },
    {
      label: t("filters.owned"),
      count: counts.owned,
      active: filters.status === "owned",
      to: href(filters, { status: "owned" }),
    },
    {
      label: t("filters.previouslyOwned"),
      count: counts.previouslyOwned,
      active: filters.status === "previously_owned",
      to: href(filters, { status: "previously_owned" }),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* On mobile the top bar has the "+" and the bottom menu names the page. */}
      <header className="hidden items-start justify-between gap-3 md:flex">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        {/* The games catalog (search, filters, your own games) lives behind "Add". */}
        <Link
          href="/games"
          className={cn(buttonVariants({ size: "lg" }), "h-11 px-5")}
        >
          {t("add")}
        </Link>
      </header>

      <Form
        action={`/${locale}/library`}
        role="search"
        className="flex flex-col gap-3"
      >
        {filters.status && (
          <input type="hidden" name="status" value={filters.status} />
        )}
        {filters.favorites && (
          <input type="hidden" name="favorites" value="1" />
        )}
        {/* CSS-only toggle: the checkbox drives the "More filters" panel. */}
        <input
          id="more-filters"
          type="checkbox"
          defaultChecked={advanced}
          className="peer sr-only"
        />
        <div className="flex gap-2">
          <Input
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={100}
            aria-label={t("search.label")}
            placeholder={t("search.placeholder")}
            className="h-11 min-w-0 flex-1"
          />
          <label
            htmlFor="more-filters"
            title={t("advanced.title")}
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "relative h-11 cursor-pointer px-3 select-none sm:px-4",
              "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
              "peer-checked:border-primary peer-checked:bg-primary/10",
            )}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">
              {t("advanced.title")}
            </span>
            {advanced && (
              <span
                aria-hidden
                className="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary"
              />
            )}
          </label>
          <Button type="submit" size="lg" className="h-11 px-5">
            {t("search.submit")}
          </Button>
        </div>

        <div className="hidden rounded-xl border border-border bg-card px-4 py-3 peer-checked:block">
          <div className="grid grid-cols-1 gap-4 pb-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="players">{t("advanced.players")}</Label>
              <Input
                id="players"
                name="players"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                defaultValue={filters.players ?? ""}
                aria-label={t("advanced.playersHint")}
                className="h-10"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="time">{t("advanced.time")}</Label>
              <Input
                id="time"
                name="time"
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                defaultValue={filters.time ?? ""}
                aria-label={t("advanced.timeHint")}
                className="h-10"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category">{t("advanced.category")}</Label>
              <NativeSelect
                id="category"
                name="category"
                defaultValue={filters.category ?? ""}
              >
                <option value="">{t("advanced.anyCategory")}</option>
                {terms.category.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mechanic">{t("advanced.mechanic")}</Label>
              <NativeSelect
                id="mechanic"
                name="mechanic"
                defaultValue={filters.mechanic ?? ""}
              >
                <option value="">{t("advanced.anyMechanic")}</option>
                {terms.mechanic.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 pb-2">
            <Button type="submit" variant="outline" className="h-10">
              {t("advanced.apply")}
            </Button>
            {advanced && (
              <Link
                href={href(filters, {
                  players: undefined,
                  time: undefined,
                  category: undefined,
                  mechanic: undefined,
                })}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                {t("advanced.clear")}
              </Link>
            )}
          </div>
        </div>
      </Form>

      {/* One row; if it overflows it scrolls by touch or by dragging with the mouse. */}
      <DragScroll aria-label={t("filters.label")} className="gap-2 py-0.5">
        {chips.map((chip) => (
          <Link
            key={chip.label}
            href={chip.to}
            aria-current={chip.active ? "true" : undefined}
            className={cn(chipClass, chip.active ? chipOn : chipOff)}
          >
            {chip.label}
            <span className="font-medium opacity-60">{chip.count}</span>
          </Link>
        ))}
        <Link
          href={href(filters, { favorites: !filters.favorites })}
          aria-current={filters.favorites ? "true" : undefined}
          className={cn(chipClass, filters.favorites ? chipOn : chipOff)}
        >
          <Star
            className={cn("size-4", filters.favorites && "fill-current")}
            aria-hidden
          />
          {t("filters.favorites")}
          <span className="font-medium opacity-60">{counts.favorites}</span>
        </Link>
      </DragScroll>

      {entries.length > 0 ? (
        <section aria-label={t("title")} className="flex flex-col gap-3">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {t("count", { count: entries.length })}
          </p>
          <ul className="flex flex-col gap-2">
            {groups.map(({ item: entry, expansions }) => {
              const badges = (e: typeof entry) => (
                <LibraryBadges
                  status={e.status}
                  isFavorite={e.isFavorite}
                  rating={e.rating}
                />
              );
              return (
                <GameCard
                  key={entry.game.id}
                  game={entry.game}
                  extra={badges(entry)}
                  expansions={expansions.map((e) => (
                    <GameCard key={e.game.id} game={e.game} extra={badges(e)} />
                  ))}
                />
              );
            })}
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
