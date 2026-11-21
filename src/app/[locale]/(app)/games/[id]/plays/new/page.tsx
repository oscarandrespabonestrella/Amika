import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getGameDetail } from "@/features/catalog";
import { listGroups } from "@/features/groups";
import { getNight } from "@/features/nights";
import { prefillFromNight } from "@/features/nights/prefill";
import { listPlayers } from "@/features/players";
import { getPlayDefaults, PlayForm } from "@/features/plays";
import { listSheetOptions } from "@/features/scoring";
import { assertLocale } from "@/i18n/locale";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewPlayPage({
  params,
  searchParams,
}: PageProps<"/[locale]/games/[id]/plays/new">) {
  const { locale: rawLocale, id } = await params;
  const query = await searchParams;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [game, sheets, roster, groups] = await Promise.all([
    getGameDetail(id, locale),
    listSheetOptions(id),
    listPlayers(),
    listGroups(),
  ]);
  if (!game) notFound(); // missing, or a private game that is not yours
  const defaults = await getPlayDefaults(id, sheets);
  const t = await getTranslations("Plays.form");

  // "Play this": a saved night (host only) or an unsaved picker group pre-fills the
  // match. Anything that is not yours or not about this game is ignored.
  const one = (v: string | string[] | undefined) =>
    typeof v === "string" ? v : undefined;
  let initialGroupId: string | undefined;
  let initialPlayerIds: string[] | undefined;
  const nightId = one(query.night);
  const night = nightId && UUID.test(nightId) ? await getNight(nightId) : null;
  if (night?.isOwner && night.games.some((g) => g.gameId === id)) {
    const prefill = prefillFromNight(night, roster);
    initialGroupId = prefill.groupId ?? undefined;
    initialPlayerIds = prefill.playerIds;
  } else {
    initialGroupId = one(query.group);
  }

  const expansions = game.relations
    .filter((r) => r.type === "has_expansion" && r.gameId !== null)
    .map((r) => ({ id: r.gameId!, name: r.name }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t("titleNew")}</h1>
      <PlayForm
        gameId={game.id}
        gameName={game.name}
        sheets={sheets}
        defaultSheetId={defaults.defaultSheetId}
        expansions={expansions}
        roster={roster}
        groups={groups}
        initialGroupId={initialGroupId}
        initialPlayerIds={initialPlayerIds}
      />
    </div>
  );
}
