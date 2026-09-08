import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { RegisterForm } from "./RegisterForm";

// Server Component: redirects an already-authenticated visitor straight to
// /dashboard rather than re-showing the register form (issue #9 acceptance
// criteria C).
export default async function RegisterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return <RegisterForm />;
}
