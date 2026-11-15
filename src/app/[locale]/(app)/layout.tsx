import { assertLocale } from "@/i18n/locale";
import { auth } from "@clerk/nextjs/server";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeSync } from "@/features/preferences";
import { getOrCreateProfile } from "@/features/profiles";
import { redirect } from "@/i18n/navigation";

export default async function AppLayout({
  children,
  params,
}: LayoutProps<"/[locale]"> & { children: ReactNode }) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  // Defense in depth: proxy.ts is only an optimistic check.
  const { userId } = await auth();
  if (!userId) redirect({ href: "/sign-in", locale });

  const profile = await getOrCreateProfile();

  return (
    <AppShell>
      {profile && <ThemeSync profileTheme={profile.theme} />}
      {children}
    </AppShell>
  );
}
