"use client";

import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

/** Clerk's avatar menu with Settings added (it is no longer a navigation item). */
export function AccountMenu() {
  const t = useTranslations("Nav");
  const locale = useLocale();
  return (
    <UserButton>
      <UserButton.MenuItems>
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
