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
