import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./types";

// Server-side Supabase client for Server Components/Actions, wired to
// next/headers' cookies() for the session cookie per the documented
// @supabase/ssr pattern. Reads only the two NEXT_PUBLIC_ vars wired in #2 —
// no service-role key, no other env vars.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // The `setAll` method was called from a Server Component. This
            // can be ignored if there is middleware refreshing user
            // sessions (see #9 — session-refresh middleware is out of
            // scope for this task).
          }
        },
      },
    },
  );
}
