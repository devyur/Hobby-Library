import { getRecommendations } from "@/lib/queries/dashboard";

import { RecommendationsPanel } from "./RecommendationsPanel";

// Dashboard's Recommendations block (issue #28, made interactive by #44),
// composed into dashboard/page.tsx at the insertion point #27 left. Stays a
// Server Component doing exactly one server-rendered fetch
// (getRecommendations(), lib/queries/dashboard.ts) rather than taking props
// from #27's stats component, per #28's own Constraints -- unchanged by
// #44. Everything interactive (Dismiss on every card, Shuffle for the
// Random pick group, the immediate post-dismiss Undo, and the group/
// zero-state rendering that depends on live client state) now lives in
// RecommendationsPanel.tsx, a Client Component this hands the fetched data
// to as `initialData` -- the same client/server split precedent #39
// established with sortDirection.ts/LibraryView.tsx (a thin server fetch,
// an interactive client child owning everything after the first render),
// rather than converting this whole file to a Client Component itself.
export async function RecommendationsSection() {
  const data = await getRecommendations();

  return <RecommendationsPanel initialData={data} />;
}
