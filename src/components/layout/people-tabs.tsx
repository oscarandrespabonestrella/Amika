"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/players", key: "players" },
  { href: "/friends", key: "friends" },
  { href: "/groups", key: "groups" },
] as const;

/** The parts of the "People" section: who you play with, who is linked to an account, and saved groups. */
export function PeopleTabs() {
  const t = useTranslations("People");
  const pathname = usePathname();

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="grid w-full max-w-md grid-cols-3 gap-1 rounded-xl border border-border bg-muted p-1"
    >
      {TABS.map(({ href, key }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center justify-center rounded-lg text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-secondary font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(key)}
          </Link>
        );
      })}
    </div>
  );
}
