"use client";

import { useState } from "react";

import { NavLinks } from "./NavLinks";
import type { NavItem } from "./navItems";

// The persistent app shell (issue #10, acceptance criteria A). Styled with
// the tokens from ui-style-guide.md §1 (--bg/--surface/--border/
// --text-primary/--text-secondary/--accent, the last two via NavLinks).
//
// Desktop: a left sidebar (ui-direction.md's "Overall shell" sketch), always
// visible. Mobile: a compact top bar with a hamburger toggle that reveals a
// full-width vertical nav panel -- per ui-direction.md's "Bottom/compact
// navigation on mobile" note, this keeps every destination reachable with
// no horizontal scrolling (a vertical list never needs it, unlike a
// horizontally-scrolling tab strip would). Exact spacing/touch-target
// polish is deferred to #31.
export function NavShell({
  items,
  children,
}: {
  items: NavItem[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="hidden shrink-0 flex-col gap-1 border-r border-border bg-surface p-4 md:flex md:w-56">
        <p className="px-3 pb-2 text-sm font-semibold text-text-primary">
          Hobby Library
        </p>
        <NavLinks items={items} />
      </aside>

      <div className="border-b border-border bg-surface md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold text-text-primary">
            Hobby Library
          </p>
          <button
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-panel"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileOpen((open) => !open)}
            className="flex size-9 items-center justify-center rounded-md border border-border text-text-primary"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="size-5"
              aria-hidden="true"
            >
              {mobileOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 6l12 12M18 6l-12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>
        {mobileOpen ? (
          <nav
            id="mobile-nav-panel"
            aria-label="Main navigation"
            className="border-t border-border px-4 py-3"
          >
            <NavLinks items={items} onNavigate={() => setMobileOpen(false)} />
          </nav>
        ) : null}
      </div>

      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
