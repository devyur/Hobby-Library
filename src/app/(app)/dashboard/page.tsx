import { redirect } from "next/navigation";

import { CompletionTrends } from "@/components/dashboard/CompletionTrends";
import { LibraryStats } from "@/components/dashboard/LibraryStats";
import { RecommendationsSection } from "@/components/dashboard/RecommendationsSection";
import { getDashboardData } from "@/lib/queries/dashboard";
import { createClient } from "@/lib/supabase/server";

// Dashboard (issue #27, folding in #43's completion-trend charts; #28 adds
// the Recommendations block below) -- replaces #9/#10's placeholder stub.
// Account-wide (all categories combined): the seven library-wide stats
// render via <LibraryStats /> (src/components/dashboard/LibraryStats.tsx),
// the per-category monthly completion charts via <CompletionTrends />
// (.../CompletionTrends.tsx), both fed from one combined read,
// getDashboardData() (lib/queries/dashboard.ts). <RecommendationsSection />
// (.../RecommendationsSection.tsx) is self-contained -- it fetches its own
// data via getRecommendations() (also lib/queries/dashboard.ts) rather than
// taking props from the two components above.
//
// middleware.ts already redirects unauthenticated requests to /login before
// this ever renders, so the `if (!user)` branch below is a defensive
// backstop (e.g. a session that expired between the middleware check and
// this render), not the primary guard.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { stats, trends } = await getDashboardData();

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <h1 className="text-lg font-semibold text-text-primary">Dashboard</h1>
      <LibraryStats stats={stats} />
      <CompletionTrends trends={trends} />
      <RecommendationsSection />
    </div>
  );
}
