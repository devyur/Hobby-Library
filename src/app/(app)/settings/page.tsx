import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { ImportLibraryForm } from "@/components/settings/ImportLibraryForm";

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

      <section className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
        <div>
          <p className="text-sm text-text-secondary">Export</p>
          <p className="text-sm text-text-primary">Download your entire library as JSON</p>
        </div>
        {/* Link to the Route Handler (issue #29) -- next/link (not a plain
            <a>) per this project's lint config, but it's still a real
            navigation to /api/export: the browser's own download handling
            (Content-Disposition on the response) is sufficient for a single
            JSON file, no progress/confirmation UI. */}
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/api/export">Export</Link>
          </Button>
          {/* CSV export (issue #45) -- same route, `?format=csv` branch,
              same no-progress-UI reasoning as the JSON button above. Labeled
              distinctly so the two downloads aren't confused. */}
          <Button asChild variant="outline">
            <Link href="/api/export?format=csv">Export CSV</Link>
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <p className="text-sm text-text-secondary">Import</p>
          <p className="text-sm text-text-primary">
            Upload a previously exported JSON file to recreate its items and lists in your
            library.
          </p>
          {/* Stated explicitly, not left silent (issue #30 AC): #29's export
              never carries file bytes, so import has nothing to restore a
              cover image or attachment from -- and no de-duplication exists
              in V1, so re-importing the same file always creates a second,
              full set of items/lists. */}
          <p className="text-sm text-text-secondary">
            Cover images and attachments are never restored by import (the export file never
            contains file bytes, only metadata) -- re-add them manually afterward if wanted.
            Importing the same file twice creates duplicate items and lists; there is no
            de-duplication.
          </p>
        </div>
        <ImportLibraryForm />
      </section>

      {/* Trash entry point (issue #49): moved out of the main nav since it's
          used infrequently. /trash itself is unchanged -- this is purely a
          new place to reach it from. */}
      <section className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
        <div>
          <p className="text-sm text-text-secondary">Trash</p>
          <p className="text-sm text-text-primary">
            Restore or permanently delete items you&apos;ve removed
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/trash">Trash</Link>
        </Button>
      </section>
    </div>
  );
}
