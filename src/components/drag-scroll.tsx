"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = { children: ReactNode; className?: string; "aria-label"?: string };

/**
 * Horizontal row that scrolls by touch natively and by mouse drag on desktop.
 * A drag never counts as a click on the links inside.
 */
export function DragScroll({ children, className, ...rest }: Props) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });

  return (
    <nav
      ref={ref}
      {...rest}
      className={cn(
        "flex cursor-grab touch-pan-x overflow-x-auto [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden",
        className,
      )}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse" || !ref.current) return;
        drag.current = {
          active: true,
          moved: false,
          startX: e.clientX,
          startLeft: ref.current.scrollLeft,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d.active || !ref.current) return;
        const dx = e.clientX - d.startX;
        if (Math.abs(dx) > 4) d.moved = true;
        if (d.moved) ref.current.scrollLeft = d.startLeft - dx;
      }}
      onPointerUp={() => {
        drag.current.active = false;
      }}
      onPointerLeave={() => {
        drag.current.active = false;
      }}
      onClickCapture={(e) => {
        if (drag.current.moved) {
          e.preventDefault();
          e.stopPropagation();
          drag.current.moved = false;
        }
      }}
      onDragStart={(e) => e.preventDefault()}
    >
      {children}
    </nav>
  );
}
