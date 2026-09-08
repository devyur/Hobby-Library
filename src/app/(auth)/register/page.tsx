import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getPostAuthRedirect } from "@/lib/actions/auth";
import { RegisterForm } from "./RegisterForm";

// Server Component: redirects an already-authenticated visitor straight to
// their last-visited screen (falling back to /dashboard) rather than
// re-showing the register form (issue #9 acceptance criteria C, redirect
// target updated by issue #10 acceptance criteria D).
export default async function RegisterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(await getPostAuthRedirect(user.id));
  }

  return <RegisterForm />;
}
