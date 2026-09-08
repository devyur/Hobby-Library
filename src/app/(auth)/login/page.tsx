import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getPostAuthRedirect } from "@/lib/actions/auth";
import { LoginForm } from "./LoginForm";

// Server Component: redirects an already-authenticated visitor straight to
// their last-visited screen (falling back to /dashboard) rather than
// re-showing the login form (issue #9 acceptance criteria C, redirect
// target updated by issue #10 acceptance criteria D). The interactive form
// itself is a Client Component (LoginForm) since it needs Zod validation +
// useActionState.
export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(await getPostAuthRedirect(user.id));
  }

  return <LoginForm />;
}
