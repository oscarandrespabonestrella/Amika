import { useTranslations } from "next-intl";

/**
 * The text alternative of a chart: the same numbers as a real table, folded in a
 * <details> under the chart. Cells arrive already formatted (locale-aware) by the caller.
 */
export function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  const t = useTranslations("Stats.charts");
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {t("showTable")}
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              {columns.map((c, i) => (
                <th
                  key={c}
                  scope="col"
                  className={`py-2 pr-3 font-medium ${i > 0 ? "text-right tabular-nums" : ""}`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-border/60 last:border-0">
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th
                      key={i}
                      scope="row"
                      className="max-w-[16rem] py-2 pr-3 text-left font-normal break-words"
                    >
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className="py-2 pr-3 text-right tabular-nums">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
