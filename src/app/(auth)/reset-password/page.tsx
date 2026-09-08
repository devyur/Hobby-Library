import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

// Server Component: this page is only ever reached with a working recovery
// session in one of two ways -- via /auth/confirm's successful
// verifyOtp() redirect, or (per the "reset-password submitted after the
// recovery session expires mid-form" edge case) directly, with no session
// at all. Checking `getUser()` here covers both the "landed here with a
// bad token" and "session already gone" cases from the same code path
// (issue #9 acceptance criteria E / edge cases): no session -> the
// invalid/expired error state; a session -> the real form.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-text-primary">
          Link invalid or expired
        </h1>
        <p className="text-sm text-text-secondary">
          This link is invalid or has expired.
        </p>
        <Link href="/forgot-password" className="text-sm text-accent hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return <ResetPasswordForm />;
}
