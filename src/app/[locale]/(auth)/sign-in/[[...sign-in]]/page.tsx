import { assertLocale } from "@/i18n/locale";
import { SignIn } from "@clerk/nextjs";
import { setRequestLocale } from "next-intl/server";
import { Brand } from "@/components/brand";

export default async function SignInPage({
  params,
}: PageProps<"/[locale]/sign-in/[[...sign-in]]">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Brand />
      <SignIn path={`/${locale}/sign-in`} signUpUrl={`/${locale}/sign-up`} />
    </div>
  );
}
