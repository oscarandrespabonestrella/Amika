import { assertLocale } from "@/i18n/locale";
import { SignUp } from "@clerk/nextjs";
import { setRequestLocale } from "next-intl/server";
import { Brand } from "@/components/brand";

export default async function SignUpPage({
  params,
}: PageProps<"/[locale]/sign-up/[[...sign-up]]">) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Brand />
      <SignUp path={`/${locale}/sign-up`} signInUrl={`/${locale}/sign-in`} />
    </div>
  );
}
