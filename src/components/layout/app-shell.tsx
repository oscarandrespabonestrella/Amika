import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { InstallBanner } from "@/features/pwa";
import { AccountMenu } from "./account-menu";
import { AppNav } from "./app-nav";
import { HeaderAddButton } from "./header-add-button";

/** Mobile: top bar + bottom tab bar. Desktop: fixed sidebar. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="px-1 pt-1">
          <Brand href="/home" />
        </div>
        <AppNav variant="sidebar" />
        <div className="mt-auto px-1 pb-1">
          <AccountMenu />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:hidden">
          <Brand href="/home" />
          <div className="flex items-center gap-1">
            <HeaderAddButton />
            <AccountMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:py-10 md:pb-10">
          {children}
        </main>
      </div>

      <AppNav variant="bottom" />
      <InstallBanner />
    </div>
  );
}
