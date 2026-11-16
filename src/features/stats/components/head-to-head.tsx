import { useFormatter, useTranslations } from "next-intl";
import type { Rival } from "../services/stats-service";

/**
 * "Me" against each rival. The numbers are in the table; the thin bar under each name
 * only restates my wins / ties / their wins as proportions (hidden from assistive tech).
 */
export function HeadToHead({ rivals }: { rivals: Rival[] }) {
  const t = useTranslations("Stats.page");
  const format = useFormatter();

  return (
    <section
      aria-labelledby="h2h-title"
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
    >
      <h2 id="h2h-title" className="text-lg font-semibold tracking-tight">
        {t("h2hTitle")}
      </h2>
      {rivals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("h2hEmpty")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("h2hHint")}</p>
          <ul
            aria-hidden
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
          >
            <Key className="bg-[var(--chart-1)]" label={t("mine")} />
            <Key className="bg-muted-foreground/40" label={t("ties")} />
            <Key className="bg-[var(--chart-2)]" label={t("theirs")} />
          </ul>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("h2hTitle")}</caption>
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 font-medium">
                    {t("rival")}
                  </th>
                  {(["together", "mine", "theirs", "ties"] as const).map(
                    (k) => (
                      <th
                        key={k}
                        scope="col"
                        className="py-2 pr-2 text-right font-medium"
                      >
                        {t(k)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rivals.map((r) => (
                  <tr
                    key={r.playerId}
                    className="border-b border-border/60 last:border-0"
                  >
                    <th
                      scope="row"
                      className="max-w-[12rem] py-2 pr-2 text-left font-medium"
                    >
                      <span className="block break-words">{r.name}</span>
                      <span
                        aria-hidden
                        className="mt-1.5 flex h-1.5 w-full max-w-32 gap-0.5 overflow-hidden rounded-full"
                      >
                        <Seg n={r.myWins} className="bg-[var(--chart-1)]" />
                        <Seg n={r.ties} className="bg-muted-foreground/40" />
                        <Seg n={r.theirWins} className="bg-[var(--chart-2)]" />
                      </span>
                    </th>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {format.number(r.playsTogether)}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {format.number(r.myWins)}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {format.number(r.theirWins)}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {format.number(r.ties)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className={`size-2.5 rounded-sm ${className}`} />
      {label}
    </li>
  );
}

function Seg({ n, className }: { n: number; className: string }) {
  return n > 0 ? (
    <span className={className} style={{ flexGrow: n, flexBasis: 0 }} />
  ) : null;
}
