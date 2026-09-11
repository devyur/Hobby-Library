import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LibraryStats } from "@/components/dashboard/LibraryStats";
import { getCategoryDashboardStats } from "@/lib/queries/dashboard";
import { createClient } from "@/lib/supabase/server";

// Per-category Dashboard drill-down (issue #50) -- reached by clicking a row
// in the account-wide Dashboard's "Category breakdown" list
// (CategoryBreakdownList, LibraryStats.tsx). Reuses LibraryStats.tsx as-is
// (plus its new showCategoryBreakdown prop) fed by getCategoryDashboardStats
// (lib/queries/dashboard.ts) rather than forking a second stats component --
// "Your library" totals, "Library statistics" (average rating/completion
// rate/rating distribution), and "Recently added" render exactly as they do
// account-wide, just filtered to this one category_id.
//
// Deliberately does NOT render CompletionTrends or RecommendationsSection --
// those stay exclusively on /dashboard (issue #50's own out-of-scope list),
// so this page only ever imports LibraryStats, not the other two Dashboard
// sections dashboard/page.tsx composes.
//
// Slug->category lookup + notFound() copied verbatim from [category]/page.tsx
// (issue #12) -- same table, same select("id, name") by slug, same miss
// behavior -- per the issue's own "reuse the lookup pattern rather than
// inventing a new one" constraint.
export default async function CategoryDashboardPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: slug } = await params;

  const supabase = await createClient();

  // Category lookup and the auth check are independent reads (same
  // reasoning as [category]/page.tsx's own copy of this pattern, added
  // alongside it by issue #58's sequential-query audit) -- run them
  // concurrently rather than awaiting the category lookup first.
  const [{ data: category }, { data: { user } }] = await Promise.all([
    supabase.from("categories").select("id, name").eq("slug", slug).maybeSingle(),
    supabase.auth.getUser(),
  ]);

  if (!category) {
    notFound();
  }

  // proxy.ts (#9) already redirects unauthenticated requests to /login
  // before this ever renders -- same defensive-only backstop dashboard/
  // page.tsx already has (e.g. a session that expired between the
  // proxy.ts check and this render).
  if (!user) {
    redirect("/login");
  }

  const stats = await getCategoryDashboardStats(category.id);

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard"
          className="w-fit text-sm text-text-secondary hover:text-accent"
        >
          ← Dashboard
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-text-primary">{category.name}</h1>
          <Link href={`/${slug}`} className="text-sm text-accent hover:underline">
            View all {category.name}
          </Link>
        </div>
      </div>
      <LibraryStats stats={stats} showCategoryBreakdown={false} />
    </div>
  );
}
