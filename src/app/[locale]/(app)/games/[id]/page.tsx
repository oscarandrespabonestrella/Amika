import { assertLocale } from "@/i18n/locale";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { GameDetailView, getGameDetail } from "@/features/catalog";

export default async function GamePage({
  params,
}: PageProps<"/[locale]/games/[id]">) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const game = await getGameDetail(id, locale);
  if (!game) notFound();

  return <GameDetailView game={game} />;
}
