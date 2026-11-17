import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { APP_NAME } from "@/lib/constants";

/** Meeple silhouette of the Amika logo (flat, single colour). */
function Meeple({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={className}>
      <circle cx="50" cy="24" r="15" />
      <path d="M38 38C22 39 8 44 8 54c0 6 5 8 10 8h8L16 80c-4 7-1 14 7 14h15c4 0 6-2 8-5l4-7 4 7c2 3 4 5 8 5h15c8 0 11-7 7-14L74 62h8c5 0 10-2 10-8 0-10-14-15-30-16z" />
    </svg>
  );
}

/**
 * Dark theme: the supplied logo (white wordmark, transparent background).
 * Light theme: only a dark logo exists, so it is rebuilt as meeple + text.
 */
export function Brand({ href = "/" }: { href?: "/" | "/home" }) {
  return (
    <Link
      href={href}
      aria-label={APP_NAME}
      className="inline-flex items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Image
        src="/Logo_Dark.png"
        alt=""
        width={2172}
        height={724}
        priority
        className="hidden h-9 w-auto dark:block"
      />
      <span className="flex items-center gap-2 dark:hidden">
        <Meeple className="size-7 fill-primary" />
        <span className="font-brand text-2xl leading-none tracking-tight">
          amika
        </span>
      </span>
    </Link>
  );
}
