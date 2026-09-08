"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { updateLastScreen } from "@/lib/actions/preferences";

// Mounted once inside (app)/layout.tsx (issue #10, acceptance criteria E) --
// renders nothing, just watches `usePathname()` and fire-and-forgets a
// `user_preferences.last_screen` write on every path change, including the
// initial page landed on (the effect below runs on mount too, not just on
// subsequent client-side navigations). `usePathname()` never includes the
// query string, so no extra stripping is needed here.
//
// Errors are swallowed exactly like updateThemePreference's caller
// (ThemeToggle.tsx, #8): no session, a network hiccup, anything -- this
// never blocks rendering or surfaces a loading/error state to the user.
export function LastScreenTracker() {
  const pathname = usePathname();

  useEffect(() => {
    updateLastScreen(pathname).catch(() => {
      // Intentionally swallowed -- see the comment above.
    });
  }, [pathname]);

  return null;
}
