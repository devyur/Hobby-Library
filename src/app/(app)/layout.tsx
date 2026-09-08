import { getCategories } from "@/lib/queries/categories";
import { buildNavItems } from "@/components/nav/navItems";
import { NavShell } from "@/components/nav/NavShell";
import { LastScreenTracker } from "@/components/nav/LastScreenTracker";

// The real app shell (issue #10, acceptance criteria A) -- replaces #9's
// bare placeholder. Fetches the categories once per request (Server
// Component) and hands the fully-built nav item list to NavShell, which
// handles active-highlighting/mobile treatment client-side.
// LastScreenTracker is mounted once here (not per-page) so every route
// under this layout -- including the four stub pages added by this issue --
// gets its `last_screen` write; it never runs for (auth) routes, which sit
// outside this layout entirely.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const categories = await getCategories();
  const items = buildNavItems(categories);

  return (
    <div className="flex flex-1 flex-col bg-bg text-text-primary">
      <LastScreenTracker />
      <NavShell items={items}>{children}</NavShell>
    </div>
  );
}
