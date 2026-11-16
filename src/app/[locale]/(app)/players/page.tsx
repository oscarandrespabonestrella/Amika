import { Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { listPlayers } from "@/features/players";
import { PlayersManager } from "@/features/players/components/players-manager";
import { assertLocale } from "@/i18n/locale";

export default async function PlayersPage({
  params,
}: PageProps<"/[locale]/players">) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [t, players] = await Promise.all([
    getTranslations("Players"),
    listPlayers(),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      {players.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <PlayersManager players={players} />
      )}
    </div>
  );
}
