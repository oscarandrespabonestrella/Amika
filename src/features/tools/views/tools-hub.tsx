"use client";

import { BarChart3, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CATEGORIES, TOOL_LOOK } from "../registry";

/** /tools: the table tools by category, each opening in its own screen. */
export function ToolsHub() {
  const t = useTranslations("Tools");

  return (
    <div className="flex flex-col gap-7">
      {CATEGORIES.map(({ id, tools }) => (
        <section
          key={id}
          aria-labelledby={`tools-${id}`}
          className="flex flex-col gap-3"
        >
          <h2
            id={`tools-${id}`}
            className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {t(`categories.${id}`)}
          </h2>
          <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
            {tools.map((tool) => {
              const { icon: Icon, tone } = TOOL_LOOK[tool];
              return (
                <li key={tool}>
                  <Link
                    href={`/tools/${tool}`}
                    className="flex h-full min-h-40 flex-col gap-3 rounded-2xl border border-border bg-card p-3.5 transition-colors outline-none hover:border-ring/50 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span
                      className={cn(
                        "grid size-12 place-items-center rounded-2xl",
                        tone,
                      )}
                    >
                      <Icon className="size-6" aria-hidden />
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="text-base leading-tight font-semibold">
                        {t(`items.${tool}.name`)}
                      </span>
                      <span className="text-[13px] leading-snug text-muted-foreground">
                        {t(`items.${tool}.description`)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <Link
        href="/stats"
        className="flex min-h-15 items-center gap-3 rounded-2xl border border-dashed border-border px-3.5 py-2 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
          <BarChart3 className="size-[18px]" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">{t("stats.title")}</span>
          <span className="text-xs text-muted-foreground">
            {t("stats.body")}
          </span>
        </span>
        <ChevronRight
          className="size-[18px] text-muted-foreground"
          aria-hidden
        />
      </Link>
    </div>
  );
}
