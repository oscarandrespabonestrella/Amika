import type { NightDetail } from "./services/night-service";

/**
 * What "Play this" pre-fills in a new match: the night's group plus the accepted
 * members who are linked to one of the host's roster players (`friendId`). Invited,
 * declined or unlinked members are left out: only people who said yes and that the
 * host can actually score get a row.
 */
export function prefillFromNight(
  night: NightDetail,
  roster: { id: string; friendId: string | null }[],
): { groupId: string | null; playerIds: string[] } {
  const playerIds: string[] = [];
  for (const member of night.members) {
    if (member.status !== "accepted") continue;
    const player = roster.find((p) => p.friendId === member.userId);
    if (player && !playerIds.includes(player.id)) playerIds.push(player.id);
  }
  return { groupId: night.groupId, playerIds };
}
