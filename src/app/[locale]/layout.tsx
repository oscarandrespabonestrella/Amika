import { ClerkProvider } from "@clerk/nextjs";
import { esES, frFR, ptBR } from "@clerk/localizations";
import { shadcn } from "@clerk/ui/themes";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Nunito } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/features/pwa";
import { APP_NAME } from "@/lib/constants";
import { ZodConfig } from "@/components/zod-config";
import { type AppLocale, routing } from "@/i18n/routing";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Wordmark only (light theme logo). */
const nunito = Nunito({
  variable: "--font-nunito",
  weight: "900",
  subsets: ["latin"],
});

/** `undefined` = Clerk's built-in English. */
const CLERK_LOCALIZATIONS: Record<AppLocale, typeof esES | undefined> = {
  en: undefined,
  es: esES,
  fr: frFR,
  pt: ptBR,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    title: t("title"),
    description: t("description"),
    appleWebApp: {
      capable: true,
      title: APP_NAME,
      statusBarStyle: "black-translucent",
    },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf5" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f14" },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${nunito.variable} h-full`}
    >
      <body className="min-h-full">
        <ZodConfig />
        <ServiceWorkerRegister />
        <ClerkProvider
          localization={CLERK_LOCALIZATIONS[locale]}
          appearance={{ theme: shadcn }}
          signInUrl={`/${locale}/sign-in`}
          signUpUrl={`/${locale}/sign-up`}
          signInFallbackRedirectUrl={`/${locale}/home`}
          signUpFallbackRedirectUrl={`/${locale}/home`}
        >
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <NextIntlClientProvider>{children}</NextIntlClientProvider>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
