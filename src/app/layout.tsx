import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { createClient } from "@/lib/supabase/server";

// _docs/ui-style-guide.md §2: Inter is the only font family for V1 (no
// separate heading font), fallback system-ui/-apple-system/sans-serif.
// Replaces the placeholder Geist/Geist Mono fonts scaffolded in #1.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  fallback: ["system-ui", "-apple-system", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Hobby Library",
  description:
    "A personal cross-media library for tracking things to watch, read, listen to, and play.",
};

// Pre-paint theme resolution (issue #8, acceptance criteria D). Runs via
// next/script's `beforeInteractive` strategy, which Next.js inlines into the
// initial HTML response ahead of hydration -- this is what avoids a flash of
// the wrong theme, since the `data-theme` attribute is set before first
// paint rather than in a post-hydration effect.
//
// If the Server Component below already resolved a signed-in user's stored
// preference and rendered `data-theme` on <html> server-side, this script is
// a no-op (see the `hasAttribute` guard) -- the server-fetched preference
// takes precedence over the client-only localStorage/system-preference
// resolution, per the acceptance criteria. Otherwise (the logged-out case,
// which is the only one reachable until #9 ships auth) it resolves theme
// itself: previously-toggled localStorage value -> prefers-color-scheme ->
// light.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var el = document.documentElement;
    if (el.hasAttribute("data-theme")) return;
    var stored = localStorage.getItem("hobby-library-theme");
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    el.setAttribute("data-theme", theme);
  } catch (e) {
    // localStorage/matchMedia unavailable (e.g. private browsing) -- the
    // prefers-color-scheme media query in globals.css still applies as a
    // CSS-only fallback.
  }
})();
`;

// Server-side theme preference lookup (issue #8, acceptance criteria D):
// if a signed-in Supabase session exists (via the session cookie -- no login
// UI exists yet, see #9, so this only ever resolves for the temporary
// debug-verified session described in the issue), read
// `user_preferences.theme` for that user. A non-null value is rendered
// directly as the `data-theme` attribute below, before the client-side
// script above ever runs, so it takes precedence over the
// localStorage/system-preference resolution -- this is what syncs the
// choice across devices per ui-style-guide.md §4.
async function getServerThemePreference(): Promise<"light" | "dark" | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("user_preferences")
    .select("theme")
    .eq("user_id", user.id)
    .maybeSingle();

  // `theme` is stored as unconstrained-at-the-type-level `text` (the DB
  // check constraint restricts it to 'light'/'dark'/null -- see the #8
  // migration), so narrow explicitly rather than trusting the column type.
  return data?.theme === "light" || data?.theme === "dark"
    ? data.theme
    : null;
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const serverTheme = await getServerThemePreference();

  return (
    <html
      lang="en"
      data-theme={serverTheme ?? undefined}
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {children}
        {/* Temporary mount point for manual verification (issue #8). Final
            home is the Settings page (#11) -- this placement is not final
            UI. */}
        <ThemeToggle />
      </body>
    </html>
  );
}
