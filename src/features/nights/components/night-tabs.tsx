import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** The two jobs of game night as a segmented switch: pick now, or plan ahead. */
export function NightTabs({ current }: { current: "now" | "plan" }) {
  const t = useTranslations("Nights");
  const items = [
    { key: "now", href: "/nights", label: t("tabs.now") },
    { key: "plan", href: "/nights/new", label: t("tabs.plan") },
  ] as const;
  return (
    <nav
      aria-label={t("tabs.label")}
      className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1"
    >
      {items.map((item) => {
        const on = item.key === current;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-10 items-center justify-center rounded-lg text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              on
                ? "bg-muted font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
