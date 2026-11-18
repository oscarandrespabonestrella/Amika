import { assertLocale } from "@/i18n/locale";
import { setRequestLocale } from "next-intl/server";
import { findExpansionParents } from "@/features/catalog";
import {
  getLibraryCounts,
  LibraryView,
  listLibraryTerms,
  parseLibraryFilters,
  searchLibrary,
} from "@/features/library";

export default async function LibraryPage({
  params,
  searchParams,
}: PageProps<"/[locale]/library">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const filters = parseLibraryFilters(await searchParams);
  const [entries, terms, counts] = await Promise.all([
    searchLibrary(filters),
    listLibraryTerms(locale),
    getLibraryCounts(),
  ]);
  const parents = await findExpansionParents(entries.map((e) => e.game));

  return (
    <LibraryView
      locale={locale}
      filters={filters}
      entries={entries}
      terms={terms}
      counts={counts}
      parents={parents}
    />
  );
}
