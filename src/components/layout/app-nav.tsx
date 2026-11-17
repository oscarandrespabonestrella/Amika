"use client";

import { BarChart3, BookMarked, Home, Settings, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** `also`: other sections that belong to the item (the games catalog is reached from "Add" in the library). */
const ITEMS: readonly {
  href: string;
  key: "home" | "friends" | "library" | "stats" | "settings";
  icon: typeof Home;
  also?: readonly string[];
}[] = [
  { href: "/home", key: "home", icon: Home },
  { href: "/friends", key: "friends", icon: Users },
  { href: "/library", key: "library", icon: BookMarked, also: ["/games"] },
  { href: "/stats", key: "stats", icon: BarChart3 },
  { href: "/settings", key: "settings", icon: Settings },
];

type AppNavProps = { variant: "sidebar" | "bottom" };

export function AppNav({ variant }: AppNavProps) {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className={cn(
        variant === "sidebar" && "flex flex-col gap-1",
        variant === "bottom" &&
          "fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden",
      )}
    >
      {ITEMS.map(({ href, key, icon: Icon, also }) => {
        const active = [href, ...(also ?? [])].some(
          (base) => pathname === base || pathname.startsWith(`${base}/`),
        );
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              variant === "sidebar" &&
                "gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              variant === "sidebar" &&
                (active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"),
              variant === "bottom" &&
                "min-h-14 flex-col justify-center gap-1 text-xs font-medium",
              variant === "bottom" &&
                (active ? "text-primary" : "text-muted-foreground"),
            )}
          >
            <Icon className="size-5" aria-hidden />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
