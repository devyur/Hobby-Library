"use server";

import { createClient } from "@/lib/supabase/server";
import { getRandomPlannedRecommendation, type RecommendationItem } from "@/lib/queries/dashboard";

// Dismiss/Undo/Shuffle Server Actions for Dashboard Recommendations (issue
// #44). Called directly from RecommendationsPanel.tsx (a Client Component),
// same "own immediate Server Action call, no form" shape as
// restoreItemAction/permanentlyDeleteItemAction (lib/actions/trash.ts).

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type DismissRecommendationActionResult = { success: true } | { error: string };
export type UndismissRecommendationActionResult = { success: true } | { error: string };

// Same ownership/not-found check as getOwnedItem in lib/actions/
// attachments.ts/links.ts, reimplemented locally (neither exports a shared
// helper): a request naming another user's item id (or a soft-deleted one)
// resolves to `null` here, exactly like a wholly nonexistent id, never a
// distinguishable error. Never relies on RLS (items_select_own, etc.) alone.
async function getOwnedItem(
  supabase: SupabaseServerClient,
  itemId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const { data: item } = await supabase
    .from("items")
    .select("id")
    .eq("id", itemId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  return item;
}

// Dismiss (issue #44's Dismiss acceptance criteria) -- sets
// `recommendation_dismissed_at` to now(), the same soft-state pattern
// restoreItemAction (trash.ts) uses for `deleted_at`, just the opposite
// direction (null -> now() here; now() -> null there). Keyed purely by the
// item's own id/row (the column's own default), so a dismissed item that's
// later deleted and replaced by a new, separate row is never treated as
// already dismissed -- there is no "conceptual identity" tracked here at
// all, only this specific row.
export async function dismissRecommendationAction(
  itemId: string,
): Promise<DismissRecommendationActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to dismiss a recommendation." };
  }

  const item = await getOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item could not be found." };
  }

  const { error } = await supabase
    .from("items")
    .update({ recommendation_dismissed_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) {
    return { error: "Failed to dismiss this recommendation. Please try again." };
  }

  return { success: true };
}

// Undo (issue #44's immediate post-dismiss Undo only -- no later
// undo/manage screen, that's #54) -- flips `recommendation_dismissed_at`
// back to null. RecommendationsPanel.tsx only ever offers this for the one
// item it just dismissed, and only for a short window after -- this action
// itself places no time limit of its own, since the window is entirely a
// client-side UI affordance, not a server-enforced one.
export async function undismissRecommendationAction(
  itemId: string,
): Promise<UndismissRecommendationActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to undo a dismiss." };
  }

  const item = await getOwnedItem(supabase, itemId, user.id);
  if (!item) {
    return { error: "This item could not be found." };
  }

  const { error } = await supabase
    .from("items")
    .update({ recommendation_dismissed_at: null })
    .eq("id", itemId);
  if (error) {
    return { error: "Failed to undo that dismiss. Please try again." };
  }

  return { success: true };
}

// Shuffle (issue #44's Refresh acceptance criteria) + the auto-replacement
// fired when the Random pick's own item is dismissed -- both call this one
// action, which just re-rolls via getRandomPlannedRecommendation
// (lib/queries/dashboard.ts): same selection/filtering logic as the initial
// server-rendered pick (excludes deleted_at/recommendation_dismissed_at,
// scoped to the signed-in user), freshly evaluated, allowed to return the
// same item as before (no distinctness guarantee, per this issue's own
// acceptance criteria) or `null` if no eligible Planned item remains.
export async function rerollRandomPlannedAction(): Promise<RecommendationItem | null> {
  return getRandomPlannedRecommendation();
}
