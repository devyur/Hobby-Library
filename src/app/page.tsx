import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getPostAuthRedirect } from "@/lib/actions/auth";

// Public marketing/landing page. Server Component so it can redirect an
// already-authenticated visitor straight to their last-visited screen
// (falling back to /dashboard) instead of showing the marketing copy again
// -- same "where does an authenticated user go" check as (auth)/login and
// (auth)/register (issue #9 acceptance criteria C, #10 acceptance criteria
// D), reused here via the shared getPostAuthRedirect helper.
//
// For a logged-out visitor, this is the only entry point into the app --
// the original scaffold from #1 had no Login/Register links, leaving a
// first-time visitor stuck.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(await getPostAuthRedirect(user.id));
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-text-primary">
        Hobby Library
      </h1>
      <p className="max-w-md text-lg text-text-secondary">
        Your personal cross-media library for tracking what you play, read,
        watch, and listen to.
      </p>
      <div className="flex items-center gap-3">
        <Button asChild>
          <Link href="/register">Register</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Log in</Link>
        </Button>
      </div>
    </main>
  );
}
