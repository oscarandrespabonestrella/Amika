import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { Reason } from "../rank";

/** Why a game is on the shortlist, as small badges. */
export function ReasonBadges({ reasons }: { reasons: readonly Reason[] }) {
  const t = useTranslations("Nights.reasons");
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {reasons.map((reason) => (
        <li key={reason.key}>
          <Badge variant="secondary">
            {reason.key === "notPlayedFor"
              ? t("notPlayedFor", { months: reason.months })
              : reason.key === "fitsPlayers"
                ? t("fitsPlayers", { players: reason.players })
                : t(reason.key)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
