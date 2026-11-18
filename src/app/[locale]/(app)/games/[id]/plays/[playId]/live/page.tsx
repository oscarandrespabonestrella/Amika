import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getGameDetail } from "@/features/catalog";
import { listFriends } from "@/features/friends";
import { getPlay } from "@/features/plays";
import { LivePlay } from "@/features/plays/views/live-play";
import { getLivePlay } from "@/features/plays/services/sharing-service";
import { assertLocale } from "@/i18n/locale";

export default async function LivePlayPage({
  params,
}: PageProps<"/[locale]/games/[id]/plays/[playId]/live">) {
  const { locale: rawLocale, id, playId } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [game, play, live, friends, { userId }] = await Promise.all([
    getGameDetail(id, locale),
    getPlay(playId),
    getLivePlay(playId),
    listFriends(),
    auth(),
  ]);
  // Missing, not yours (RLS: owner or accepted member only) or under the wrong game: a 404.
  if (!userId || !game || !play || !live || play.gameId !== game.id) notFound();
  const t = await getTranslations("Live");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <LivePlay
        key={live.id}
        initial={live}
        definition={play.sheet?.definition ?? null}
        me={userId}
        isOwner={play.ownerId === userId}
        friends={friends}
        gameId={game.id}
        gameName={game.name}
      />
    </div>
  );
}
