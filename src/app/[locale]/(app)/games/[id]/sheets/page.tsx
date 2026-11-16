import { ArrowLeft, ClipboardList } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { getGameDetail } from "@/features/catalog";
import { listSheetsForGame, SheetsList } from "@/features/scoring";
import { assertLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";

export default async function SheetsPage({
  params,
}: PageProps<"/[locale]/games/[id]/sheets">) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [game, sheets] = await Promise.all([
    getGameDetail(id, locale),
    listSheetsForGame(id),
  ]);
  if (!game) notFound(); // missing, or a private game that is not yours
  const t = await getTranslations("Scoring");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Link
        href={`/games/${game.id}`}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back", { game: game.name })}
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("subtitle", { game: game.name })}
        </p>
      </header>

      <div>
        <Link
          href={`/games/${game.id}/sheets/new`}
          className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t("new")}
        </Link>
      </div>

      {sheets.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <SheetsList gameId={game.id} sheets={sheets} />
      )}
    </div>
  );
}
