import { Dices } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { APP_NAME } from "@/lib/constants";

export function Brand({ href = "/" }: { href?: "/" | "/home" }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Dices className="size-4.5" aria-hidden />
      </span>
      <span>{APP_NAME}</span>
    </Link>
  );
}
