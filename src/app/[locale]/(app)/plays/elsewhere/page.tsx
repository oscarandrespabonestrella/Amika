import { Home } from "lucide-react";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { listElsewherePlays } from "@/features/plays/services/sharing-service";
import { assertLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";

export default async function ElsewherePage({
  params,
}: PageProps<"/[locale]/plays/elsewhere">) {
  const { locale: rawLocale } = await params;
  setRequestLocale(assertLocale(rawLocale));

  const [t, format, plays] = await Promise.all([
    getTranslations("Elsewhere"),
    getFormatter(),
    listElsewherePlays(),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>
      {plays.length === 0 ? (
        <EmptyState icon={Home} title={t("title")} description={t("empty")} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="elsewhere-list">
          {plays.map((p) => (
            <li key={p.playId}>
              <Link
                href={`/games/${p.gameId}/plays/${p.playId}/live`}
                className="flex flex-col gap-1 rounded-xl border border-border p-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <strong>{p.gameName}</strong>
                <span className="text-sm text-muted-foreground">
                  {format.dateTime(new Date(p.playedOn), {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  })}
                  {p.ownerName ? ` · ${t("with", { owner: p.ownerName })}` : ""}
                  {p.status === "open" ? ` · ${t("live")}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
