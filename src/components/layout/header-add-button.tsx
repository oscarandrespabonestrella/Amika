"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/** Top-bar shortcut to the games catalog; only shown in the library. */
export function HeaderAddButton() {
  const t = useTranslations("Library");
  const pathname = usePathname();
  if (pathname !== "/library") return null;

  return (
    <Link
      href="/games"
      aria-label={t("add")}
      className="grid size-11 place-items-center rounded-xl text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Plus className="size-[22px]" strokeWidth={1.9} aria-hidden />
    </Link>
  );
}
