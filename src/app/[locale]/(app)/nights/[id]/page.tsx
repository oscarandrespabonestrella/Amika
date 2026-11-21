import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { listFriends } from "@/features/friends";
import { parseLibraryFilters, searchLibrary } from "@/features/library";
import { getNight } from "@/features/nights";
import { idSchema } from "@/features/nights/schemas";
import { NightDetail } from "@/features/nights/views/night-detail";
import { assertLocale } from "@/i18n/locale";

export default async function NightPage({
  params,
}: PageProps<"/[locale]/nights/[id]">) {
  const { locale: rawLocale, id } = await params;
  setRequestLocale(assertLocale(rawLocale));

  if (!idSchema.safeParse(id).success) notFound();
  const night = await getNight(id);
  if (!night) notFound();

  const onNight = new Set(night.games.map((g) => g.gameId));
  const [friends, library] = await Promise.all([
    night.isOwner ? listFriends() : Promise.resolve([]),
    night.isOwner || night.status === "closed"
      ? Promise.resolve([])
      : searchLibrary(parseLibraryFilters({ status: "owned" })),
  ]);

  return (
    <NightDetail
      night={night}
      friends={friends.map((f) => ({ userId: f.userId, name: f.displayName }))}
      suggestable={library
        .filter((e) => !e.game.isCustom && !onNight.has(e.game.id))
        .map((e) => ({ gameId: e.game.id, name: e.game.name }))}
    />
  );
}
