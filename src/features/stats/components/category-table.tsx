import { useFormatter, useTranslations } from "next-intl";
import type { GameCategoryStats } from "../services/stats-service";

/**
 * Average points per scoring category and player (for the sheet version most matches
 * used). A table, not a chart: a sheet has many categories that all carry meaning. The
 * thin bar in each cell is relative to the highest average of that category.
 */
export function CategoryTable({ data }: { data: GameCategoryStats }) {
  const t = useTranslations("Stats.categories");
  const format = useFormatter();
  const max = (key: string) =>
    Math.max(0, ...data.rows.map((r) => r.averages[key] ?? 0));

  return (
    <section aria-labelledby="categories-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id="categories-title" className="text-sm font-medium">
          {t("title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("basis", {
            sheet: data.sheetTitle,
            version: data.version,
            count: data.used,
          })}
          {data.skipped > 0 && ` ${t("skipped", { count: data.skipped })}`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("title")}</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("player")}
              </th>
              {data.categories.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="min-w-20 py-2 pr-3 text-right font-medium"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr
                key={r.playerId}
                className="border-b border-border/60 last:border-0"
              >
                <th
                  scope="row"
                  className="max-w-[12rem] py-2 pr-3 text-left font-medium break-words"
                >
                  {r.name}
                </th>
                {data.categories.map((c) => {
                  const value = r.averages[c.key] ?? 0;
                  const top = max(c.key);
                  return (
                    <td
                      key={c.key}
                      className="py-2 pr-3 text-right tabular-nums"
                    >
                      {format.number(value, { maximumFractionDigits: 1 })}
                      <span
                        aria-hidden
                        className="mt-1 ml-auto block h-1 rounded-full bg-[var(--chart-1)]"
                        style={{
                          width:
                            top > 0
                              ? `${(Math.max(0, value) / top) * 100}%`
                              : 0,
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
