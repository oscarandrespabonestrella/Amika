import { X } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { listFriends } from "@/features/friends";
import { listGroups } from "@/features/groups";
import {
  getPickerShortlist,
  parsePickerQuery,
  todayIso,
} from "@/features/nights";
import { NightTabs } from "@/features/nights/components/night-tabs";
import {
  NightPicker,
  type GroupFriend,
} from "@/features/nights/views/night-picker";
import { listPlayers } from "@/features/players";
import { assertLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";

export default async function NewNightPage({
  params,
  searchParams,
}: PageProps<"/[locale]/nights/new">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const query = parsePickerQuery(await searchParams);
  // UTC date: only ranks games; a day of drift near midnight is acceptable.
  const today = todayIso();
  const [t, groups, initial, players, friends] = await Promise.all([
    getTranslations("Nights"),
    listGroups(),
    getPickerShortlist(query, today),
    listPlayers(),
    listFriends(),
  ]);

  // Per group: its players linked to a friend, named as the friend calls themself.
  const friendOf = new Map(
    players.filter((p) => p.friendId).map((p) => [p.id, p.friendId!]),
  );
  const friendName = new Map(friends.map((f) => [f.userId, f.displayName]));
  const groupFriends: Record<string, GroupFriend[]> = Object.fromEntries(
    groups.map((g) => [
      g.id,
      g.members.flatMap((m) => {
        const userId = friendOf.get(m.id);
        return userId && friendName.has(userId)
          ? [{ userId, name: friendName.get(userId) || m.name }]
          : [];
      }),
    ]),
  );

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-1">
          <Link
            href="/nights"
            aria-label={t("back")}
            className="-ml-3 grid size-11 place-items-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-5" aria-hidden />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("newTitle")}
          </h1>
        </div>
        <NightTabs current="plan" />
      </header>
      <NightPicker
        mode="plan"
        groups={groups}
        initial={initial}
        query={query}
        groupFriends={groupFriends}
      />
    </div>
  );
}
