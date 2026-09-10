"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { isNavItemActive, type NavItem } from "./navItems";

// Shared active-highlighted link list, rendered both in the desktop
// sidebar and the mobile collapsible panel (NavShell.tsx) -- issue #10
// acceptance criteria A: the active section is visibly distinguished via
// the accent token, driven by the current pathname.
//
// Link sizing is mobile-first (py-3, ~44px tall -- WCAG 2.2 SC 2.5.8 /
// Apple HIG touch-target baseline, issue #31) with md:py-2 restoring the
// original ~36px desktop density. This works correctly even though both
// the desktop <aside> and the mobile panel render the same component: only
// one of the two wrapping containers is ever visible at a given viewport
// width (NavShell.tsx's `hidden md:flex` aside vs. its `md:hidden` mobile
// bar), so the md: breakpoint here lines up with which instance is
// actually on screen -- same "responsive classes, not a separate mobile
// component" pattern as everywhere else in this pass.
export function NavLinks({
  items,
  onNavigate,
}: {
  items: NavItem[];
  // Called after a link is clicked -- used by the mobile panel to close
  // itself on navigation. Omitted (no-op) for the always-visible desktop
  // sidebar.
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isNavItemActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "block rounded-md px-3 py-3 text-sm font-medium transition-colors md:py-2",
                active
                  ? "bg-accent text-white"
                  : "text-text-secondary hover:bg-bg hover:text-text-primary",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
