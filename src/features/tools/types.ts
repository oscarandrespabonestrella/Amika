/** The user's saved players and groups, so a tool can offer them instead of retyping. */
export type ToolRoster = {
  players: { id: string; name: string }[];
  groups: { id: string; name: string; members: string[] }[];
};
