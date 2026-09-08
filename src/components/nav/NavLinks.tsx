"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { isNavItemActive, type NavItem } from "./navItems";

// Shared active-highlighted link list, rendered both in the desktop
// sidebar and the mobile collapsible panel (NavShell.tsx) -- issue #10
// acceptance criteria A: the active section is visibly distinguished via
// the accent token, driven by the current pathname.
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
                "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
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
