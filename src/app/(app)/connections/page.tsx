import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { SteamConnectionCard } from "@/components/connections/SteamConnectionCard";

// Connections page (issue #62) -- where a user imports their library from an
// external service, reviewed and selected item-by-item, not a blind bulk
// import. Steam is the first (currently only) service; this page renders a
// vertical stack of service cards so a second service (books/video, per
// plan.md's multi-category vision) is just another card appended below --
// no rearchitecting of this page needed when that lands.
//
// Same auth guard as settings/page.tsx -- proxy.ts already redirects an
// unauthenticated request to /login before this ever renders, so the
// `if (!user)` branch is a defensive backstop, not the primary gate.
export default async function ConnectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Connections</h1>
        <p className="text-sm text-text-secondary">
          Import your library from an external service. Nothing is added automatically -- you
          review the results and choose which items to bring in.
        </p>
      </div>

      <SteamConnectionCard />
    </div>
  );
}
