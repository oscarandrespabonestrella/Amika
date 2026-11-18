import { Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PeopleTabs } from "@/components/layout/people-tabs";
import { listGroups } from "@/features/groups";
import { GroupsManager } from "@/features/groups/components/groups-manager";
import { listPlayers } from "@/features/players";
import { assertLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";

export default async function GroupsPage({
  params,
}: PageProps<"/[locale]/groups">) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [t, groups, players] = await Promise.all([
    getTranslations("Groups"),
    listGroups(),
    listPlayers(),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PeopleTabs />
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      {players.length === 0 ? (
        <>
          <EmptyState
            icon={Users}
            title={t("noPlayersTitle")}
            description={t("noPlayersDescription")}
          />
          <Link
            href="/players"
            className="text-center text-sm font-medium underline"
          >
            {t("goToPlayers")}
          </Link>
        </>
      ) : (
        <>
          <GroupsManager groups={groups} players={players} />
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          )}
        </>
      )}
    </div>
  );
}
