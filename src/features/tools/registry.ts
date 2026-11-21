import {
  Coins,
  Dices,
  EyeOff,
  Hand,
  LoaderPinwheel,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";

export const TOOL_IDS = [
  "dice",
  "finger",
  "wheel",
  "countdown",
  "teams",
  "hidden",
  "coin",
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export function isToolId(value: string): value is ToolId {
  return (TOOL_IDS as readonly string[]).includes(value);
}

/** Icon and tint (static class names so Tailwind sees them) of each tool. */
export const TOOL_LOOK: Record<ToolId, { icon: LucideIcon; tone: string }> = {
  dice: { icon: Dices, tone: "bg-chart-2/15 text-chart-2" },
  finger: { icon: Hand, tone: "bg-chart-3/15 text-chart-3" },
  wheel: { icon: LoaderPinwheel, tone: "bg-chart-4/15 text-chart-4" },
  countdown: { icon: Timer, tone: "bg-chart-1/15 text-chart-1" },
  teams: { icon: Users, tone: "bg-chart-5/15 text-chart-5" },
  hidden: { icon: EyeOff, tone: "bg-tint text-tint-foreground" },
  coin: { icon: Coins, tone: "bg-accent text-accent-foreground" },
};

export const CATEGORIES: readonly {
  id: "randomizers" | "timers" | "other";
  tools: readonly ToolId[];
}[] = [
  { id: "randomizers", tools: ["dice", "finger", "wheel"] },
  { id: "timers", tools: ["countdown"] },
  { id: "other", tools: ["teams", "hidden", "coin"] },
];
