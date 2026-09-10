"use server";

import { createClient } from "@/lib/supabase/server";

// Server Action backing ThemeToggle.tsx (issue #8, acceptance criteria D).
// Upserts (not update) `{ user_id, theme }` into `user_preferences` -- no
// row is guaranteed to exist for any user yet, since there's no signup flow
// before #9 ships. Only called client-side when a Supabase session already
// exists (see ThemeToggle.tsx); the `!user` branch below is a defensive
// backstop, not the primary guard.
export async function updateThemePreference(
  theme: "light" | "dark",
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase.from("user_preferences").upsert(
    {
      user_id: user.id,
      theme,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return { error: error?.message ?? null };
}

// Server Action backing LastScreenTracker.tsx (issue #10, acceptance
// criteria E). Same shape as updateThemePreference above: session-guarded
// upsert, errors returned rather than thrown so the caller can swallow them
// fire-and-forget. `pathname` is expected to already be path-only (no query
// string) -- LastScreenTracker.tsx is responsible for that, this action
// just persists whatever it's given.
export async function updateLastScreen(
  pathname: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase.from("user_preferences").upsert(
    {
      user_id: user.id,
      last_screen: pathname,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return { error: error?.message ?? null };
}

// Server Action backing the List/Card toggle in
// src/components/items/LibraryView.tsx (issue #12, acceptance criteria on
// persisting `user_preferences.list_view_mode`). Same session-guarded
// upsert shape as updateThemePreference/updateLastScreen above.
export async function updateListViewMode(
  mode: "list" | "card",
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase.from("user_preferences").upsert(
    {
      user_id: user.id,
      list_view_mode: mode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return { error: error?.message ?? null };
}

// Server Action backing the Sort control in
// src/components/items/LibraryView.tsx (issue #24, extended by #39 to also
// carry direction). Same session-guarded upsert shape as
// updateThemePreference/updateLastScreen/updateListViewMode above --
// optimistic local update in the client, fire-and-forget persistence here.
// `sort` matches the check constraint on user_preferences.default_sort
// (migration 20260909160000, extended by 20260910160000 for
// rating/title). `direction` matches default_sort_direction's own check
// constraint (same migration) -- folded into this one call rather than a
// paired action (issue #39's Constraints leave that choice to the
// engineer) since every caller that changes one already has the other in
// hand: LibraryView.tsx's handleSortChange resets direction to `null`
// alongside the new sort, and its handleDirectionChange always passes the
// currently-selected `sort` back unchanged alongside the new direction. A
// `null` direction persists as SQL NULL -- "use this dimension's own
// natural default direction" (resolveSortDirection, lib/queries/items.ts),
// never a stale direction value carried over from a previously-selected
// dimension.
export async function updateDefaultSort(
  sort: "recently_added" | "priority" | "status" | "rating" | "title",
  direction: "asc" | "desc" | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase.from("user_preferences").upsert(
    {
      user_id: user.id,
      default_sort: sort,
      default_sort_direction: direction,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return { error: error?.message ?? null };
}
