import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Downloads the PDF through our proxy (the browser can not read most publishers' files). */
export function DownloadLink({ href }: { href: string }) {
  const t = useTranslations("Manuals");
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} download>
        <Download aria-hidden />
        {t("result.download")}
      </a>
    </Button>
  );
}
