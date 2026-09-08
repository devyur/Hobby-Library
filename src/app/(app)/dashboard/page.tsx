import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

// Placeholder authenticated page (issue #9 acceptance criteria A/D): shows
// the signed-in user's email and a "Log out" control. This is the exact
// path project-structure.md's tree already names for the future Dashboard
// -- #10 extends this file rather than creating a new route. The
// "Log out" control's permanent home and the account-email display move to
// Settings (#11); this page is a temporary manual-verification placeholder,
// same convention as #8's temporarily-mounted ThemeToggle.
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
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <p className="text-sm text-text-secondary">Signed in as</p>
      <p className="text-lg font-semibold text-text-primary">{user.email}</p>
      <form action={logoutAction}>
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </div>
  );
}
