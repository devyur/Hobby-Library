"use client";

import { useSyncExternalStore } from "react";

import { Button } from "./button";
import { updateThemePreference } from "@/lib/actions/preferences";
import { createClient } from "@/lib/supabase/client";

// localStorage key written by both this component and the pre-paint inline
// script in layout.tsx -- keep these in sync.
const THEME_STORAGE_KEY = "hobby-library-theme";

type Theme = "light" | "dark";

// Reads the current theme from the DOM (`data-theme` on <html>, set by the
// pre-paint script / server-rendered attribute in layout.tsx) via
// useSyncExternalStore -- this is the "read from an external system" case
// its docs call out, and it avoids the SSR/client hydration mismatch a
// naive useState+useEffect read would need a "mounted" flag to paper over
// (the server snapshot is used for the first paint on both server and
// client, then reconciled to the real value right after hydration).
function subscribe(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

// Theme toggle (issue #8, acceptance criteria D). Works fully today with no
// signed-in session (the only kind reachable until #9 ships auth):
//   - Clicking flips `data-theme` on <html> immediately, no server
//     round-trip needed to see the effect.
//   - The new value is written to localStorage as the local/optimistic
//     cache, read back by the pre-paint script on the next load.
// If (and only if) an authenticated Supabase session exists client-side, the
// click additionally calls the `updateThemePreference` Server Action so the
// choice syncs across devices. If no session exists, the click still
// applies the local/optimistic change and simply skips the server call --
// no error is shown to the user.
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  async function handleClick() {
    const next: Theme = theme === "dark" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (e.g. private browsing) -- the local
      // toggle still applied above; it just won't be remembered on reload.
    }

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      // Errors are intentionally swallowed here (beyond this dev-time log):
      // the local/optimistic toggle above already succeeded, and this task
      // has no UI surface for reporting a background sync failure.
      const { error } = await updateThemePreference(next);
      if (error) {
        console.error("Failed to persist theme preference:", error);
      }
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="Toggle theme"
      onClick={handleClick}
    >
      {theme === "dark" ? "Dark" : "Light"}
    </Button>
  );
}
