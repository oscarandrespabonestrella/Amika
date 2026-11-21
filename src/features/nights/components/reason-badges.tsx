import { Clock, Sparkles, Star, Trophy, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Reason } from "../rank";

const ICONS = {
  neverPlayed: { Icon: Sparkles, tone: "text-primary" },
  notPlayedFor: { Icon: Clock, tone: "text-muted-foreground" },
  favorite: { Icon: Star, tone: "text-amber-500" },
  highlyRated: { Icon: Trophy, tone: "text-sky-500" },
  fitsPlayers: { Icon: Users, tone: "text-muted-foreground" },
} as const;

/** Why a game is on the shortlist: small tags with an icon (the colour is on the icon only). */
export function ReasonBadges({ reasons }: { reasons: readonly Reason[] }) {
  const t = useTranslations("Nights.reasons");
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-2.5 gap-y-1">
      {reasons.map((reason) => {
        const { Icon, tone } = ICONS[reason.key];
        return (
          <li
            key={reason.key}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          >
            <Icon className={`size-3.5 ${tone}`} aria-hidden />
            {reason.key === "notPlayedFor"
              ? t("notPlayedFor", { months: reason.months })
              : reason.key === "fitsPlayers"
                ? t("fitsPlayers", { players: reason.players })
                : t(reason.key)}
          </li>
        );
      })}
    </ul>
  );
}
