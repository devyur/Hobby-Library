import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

// Real Settings page (issue #11): the three things V1 Settings needs --
// account email, sign-out, and the theme toggle. Replaces the #10 stub.
//
// middleware.ts (#9) already redirects unauthenticated requests to /login
// before this ever renders, so the `if (!user)` branch below is a
// defensive backstop (e.g. a session that expired between the middleware
// check and this render), same pattern as dashboard/page.tsx.
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <h1 className="text-lg font-semibold text-text-primary">Settings</h1>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-text-secondary">Signed in as</p>
        <p className="text-base font-semibold text-text-primary">{user.email}</p>
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Log out
          </Button>
        </form>
      </section>

      <section className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-text-secondary">Theme</p>
        <ThemeToggle />
      </section>
    </div>
  );
}
