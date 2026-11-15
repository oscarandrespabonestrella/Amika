import { assertLocale } from "@/i18n/locale";
import { auth } from "@clerk/nextjs/server";
import { setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Brand } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  const { userId } = await auth();
  if (userId) redirect({ href: "/home", locale });

  return <Landing />;
}

function Landing() {
  const t = useTranslations("Landing");

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] bg-gradient-to-b from-primary/15 via-accent/40 to-transparent"
      />
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 md:px-8">
        <Brand />
        <Link
          href="/sign-in"
          className={cn(
            buttonVariants({ variant: "ghost", size: "lg" }),
            "min-h-11",
          )}
        >
          {t("signIn")}
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-8 px-4 pb-24 md:px-8">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
          {t("headline")}
        </h1>
        <p className="max-w-xl text-lg text-pretty text-muted-foreground">
          {t("subhead")}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/sign-up"
            className={cn(
              buttonVariants({ size: "lg" }),
              "min-h-12 px-6 text-base",
            )}
          >
            {t("signUp")}
          </Link>
          <Link
            href="/sign-in"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "min-h-12 px-6 text-base",
            )}
          >
            {t("signIn")}
          </Link>
        </div>
      </main>
    </div>
  );
}
