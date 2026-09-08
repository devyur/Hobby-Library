import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

// Route handler (not a page under (auth), since it performs a redirect
// rather than rendering) that completes Supabase's email-link verification
// for the password-recovery link -- issue #9 acceptance criteria A/E. This
// is the `redirectTo` target passed to `resetPasswordForEmail()` in
// lib/actions/auth.ts's `forgotPasswordAction`.
//
// Scoped to the one email-link type this task actually uses (password
// recovery) rather than the fully generic `next`-param handler Supabase's
// own Next.js integration guide shows for signup/magic-link/recovery/etc:
// this app has no email-confirmation-required signup flow and no magic-link
// login (both out of scope per the issue), so "recovery" is the only kind
// of link that will ever hit this route.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (token_hash && type === "recovery") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error) {
      redirect("/reset-password");
    }
  }

  // Missing/malformed params, a non-"recovery" type, or a used/expired
  // token all land here -- reset-password/page.tsx's own session check
  // renders the "invalid or expired" error state, since no recovery
  // session was established.
  redirect("/reset-password");
}
