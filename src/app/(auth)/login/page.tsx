import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

// Server Component: redirects an already-authenticated visitor straight to
// /dashboard rather than re-showing the login form (issue #9 acceptance
// criteria C). The interactive form itself is a Client Component
// (LoginForm) since it needs Zod validation + useActionState.
export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return <LoginForm />;
}
