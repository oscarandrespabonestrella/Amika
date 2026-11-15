"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";
import type { THEMES } from "../schemas";

/**
 * On a device that has never chosen a theme, adopt the one saved in the
 * profile. A theme chosen locally always wins afterwards.
 */
export function ThemeSync({
  profileTheme,
}: {
  profileTheme: (typeof THEMES)[number];
}) {
  const { setTheme } = useTheme();

  useEffect(() => {
    try {
      if (localStorage.getItem("theme") === null && profileTheme !== "system") {
        setTheme(profileTheme);
      }
    } catch {
      // localStorage unavailable (private mode): keep the system theme.
    }
  }, [profileTheme, setTheme]);

  return null;
}
