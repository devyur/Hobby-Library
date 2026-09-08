import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// Placeholder authenticated page (issue #9 acceptance criteria A/D). This is
// the exact path project-structure.md's tree already names for the future
// Dashboard -- #10 extends this file rather than creating a new route. The
// account-email display and "Log out" control that used to live here moved
// to their permanent home, Settings (#11); this page is now a minimal
// stub, same convention settings/page.tsx used before #11. Real content
// (stats, recommendations) is #27/#28's job.
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

  return (
    <div className="flex flex-1 flex-col gap-2 px-6 py-8">
      <h1 className="text-lg font-semibold text-text-primary">Dashboard</h1>
      <p className="text-sm text-text-secondary">
        Dashboard stats coming in #27.
      </p>
    </div>
  );
}
