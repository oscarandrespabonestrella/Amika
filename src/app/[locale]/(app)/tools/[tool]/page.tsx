import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { listGroups } from "@/features/groups";
import { listPlayers } from "@/features/players";
import { isToolId, ToolView, type ToolRoster } from "@/features/tools";
import { assertLocale } from "@/i18n/locale";

export default async function ToolPage({
  params,
}: PageProps<"/[locale]/tools/[tool]">) {
  const { locale: rawLocale, tool } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  if (!isToolId(tool)) notFound();

  // The user's own players and groups, offered so names need not be retyped.
  const [players, groups] = await Promise.all([listPlayers(), listGroups()]);
  const roster: ToolRoster = {
    players: players.map(({ id, name }) => ({ id, name })),
    groups: groups.map(({ id, name, members }) => ({
      id,
      name,
      members: members.map((m) => m.name),
    })),
  };

  return <ToolView tool={tool} roster={roster} />;
}
