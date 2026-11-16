import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Entry point on the game page: how many sheets the user has and a link to them. */
export function SheetsLink({
  gameId,
  count,
}: {
  gameId: string;
  count: number;
}) {
  const t = useTranslations("Scoring.panel");
  return (
    <section
      aria-labelledby="sheets-title"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="sheets-title"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <ClipboardList className="size-5 text-primary" aria-hidden />
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("count", { count })}</p>
      </div>
      <Link
        href={`/games/${gameId}/sheets`}
        className="inline-flex h-11 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {t("open")}
      </Link>
    </section>
  );
}
