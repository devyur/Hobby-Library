import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./types";

// Browser Supabase client. Reads only the two NEXT_PUBLIC_ vars wired in #2 —
// no service-role key, no other env vars. Use from Client Components.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
