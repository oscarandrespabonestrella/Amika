"use client";

import {
  ChevronLeft,
  CircleHelp,
  Ellipsis,
  Maximize2,
  Minimize2,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ToolId } from "../registry";
import { useFullscreen } from "../use-fullscreen";

const iconButton =
  "grid size-11 place-items-center rounded-xl text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted";

/**
 * The same header on every tool (back, title, help, fullscreen, ··· reset) around the
 * tool's own screen. Fullscreen takes this whole frame, so the title and the controls
 * stay on screen while playing.
 */
export function ToolFrame({
  id,
  onReset,
  fullscreen = true,
  children,
}: {
  id: ToolId;
  onReset: () => void;
  /** Whether a fullscreen button makes sense for this tool. */
  fullscreen?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("Tools");
  const ti = useTranslations(`Tools.items.${id}`);
  const frame = useRef<HTMLDivElement>(null);
  const screen = useFullscreen(frame);

  return (
    <div
      ref={frame}
      data-fullscreen={screen.active}
      className={cn(screen.active && "h-dvh overflow-y-auto bg-background p-4")}
    >
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-5">
        <header className="-mx-2 flex items-center">
          <Link href="/tools" aria-label={t("back")} className={iconButton}>
            <ChevronLeft className="size-[22px]" aria-hidden />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
            {ti("name")}
          </h1>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("help")}
                className={iconButton}
              >
                <CircleHelp className="size-[22px]" aria-hidden />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3.5">
              <p className="text-sm text-pretty">{ti("help")}</p>
            </PopoverContent>
          </Popover>
          {fullscreen && screen.supported && (
            <button
              type="button"
              onClick={screen.toggle}
              aria-label={screen.active ? t("exitFullscreen") : t("fullscreen")}
              className={iconButton}
            >
              {screen.active ? (
                <Minimize2 className="size-[22px]" aria-hidden />
              ) : (
                <Maximize2 className="size-[22px]" aria-hidden />
              )}
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("menu")}
                className={iconButton}
              >
                <Ellipsis className="size-[22px]" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onSelect={onReset} className="h-10 text-sm">
                <RotateCcw aria-hidden />
                {t("reset")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {children}
      </div>
    </div>
  );
}
