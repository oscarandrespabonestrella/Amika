import { getTranslations, setRequestLocale } from "next-intl/server";
import { PeopleTabs } from "@/components/layout/people-tabs";
import { listFriends } from "@/features/friends";
import { listGroups } from "@/features/groups";
import { GroupsManager } from "@/features/groups/views/groups-manager";
import { listPlayers } from "@/features/players";
import { assertLocale } from "@/i18n/locale";

export default async function GroupsPage({
  params,
}: PageProps<"/[locale]/groups">) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [t, groups, players, friends] = await Promise.all([
    getTranslations("Groups"),
    listGroups(),
    listPlayers(),
    listFriends(),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PeopleTabs />
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      <GroupsManager groups={groups} players={players} friends={friends} />
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </div>
  );
}
