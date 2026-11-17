"use client";

import {
  BarChart3,
  BookMarked,
  Dice5,
  Home,
  Settings,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/home", key: "home", icon: Home },
  { href: "/games", key: "games", icon: Dice5 },
  { href: "/library", key: "library", icon: BookMarked },
  { href: "/stats", key: "stats", icon: BarChart3 },
  { href: "/friends", key: "friends", icon: Users, sidebarOnly: true },
  { href: "/settings", key: "settings", icon: Settings },
] as const;

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
      {ITEMS.filter(
        (item) => variant === "sidebar" || !("sidebarOnly" in item),
      ).map(({ href, key, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
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
