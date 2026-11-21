"use client";

import { UserButton } from "@clerk/nextjs";
import { BarChart3, Settings } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

/** Clerk's avatar menu with Statistics and Settings added (neither is a navigation item). */
export function AccountMenu() {
  const t = useTranslations("Nav");
  const locale = useLocale();
  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link
          label={t("stats")}
          href={`/${locale}/stats`}
          labelIcon={<BarChart3 className="size-4" aria-hidden />}
        />
        <UserButton.Link
          label={t("settings")}
          href={`/${locale}/settings`}
          labelIcon={<Settings className="size-4" aria-hidden />}
        />
        <UserButton.Action label="manageAccount" />
        <UserButton.Action label="signOut" />
      </UserButton.MenuItems>
    </UserButton>
  );
}
