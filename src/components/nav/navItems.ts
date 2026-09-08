import type { CategorySummary } from "@/lib/queries/categories";

export interface NavItem {
  label: string;
  href: string;
}

// Builds the ordered nav item list per plan.md §15 and issue #10 acceptance
// criteria A/B: Dashboard, one entry per row in `categories` (already
// sorted by sort_order by getCategories()), Custom Lists, Trash, Settings.
// No category name/slug is hardcoded here (AGENTS.md) -- `categories` is
// the only source for the middle section, and each tab links to `/<slug>`
// per project-structure.md §1's `[category]/` dynamic route decision.
export function buildNavItems(categories: CategorySummary[]): NavItem[] {
  return [
    { label: "Dashboard", href: "/dashboard" },
    ...categories.map((category) => ({
      label: category.name,
      href: `/${category.slug}`,
    })),
    { label: "Custom Lists", href: "/lists" },
    { label: "Trash", href: "/trash" },
    { label: "Settings", href: "/settings" },
  ];
}

// A nav item is active on its own path and any sub-route beneath it -- e.g.
// a category tab stays active on its future item-detail routes once #13
// exists, and Custom Lists stays active on /lists/[listId] once #26 exists
// (issue #10 acceptance criteria A).
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
