"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  type AuthFormState,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

// Next.js's `redirect()` works by throwing a special digest-tagged error
// that the framework itself catches -- re-throw it as-is rather than
// letting a surrounding catch block below turn it into a form error.
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

// Builds the absolute origin for Supabase email-link `redirectTo` URLs from
// the incoming request's headers (Server Actions have no direct access to
// the browser's `window.location`). Falls back to the `host` header (always
// present) when `origin` isn't sent, deriving the protocol from NODE_ENV
// since this sandbox's dev server is always plain HTTP.
async function getSiteOrigin(): Promise<string> {
  const headersList = await headers();
  const origin = headersList.get("origin");
  if (origin) return origin;

  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${protocol}://${host}`;
}

function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

export async function registerAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { formError: null, fieldErrors: zodFieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return mapRegisterError(error);
  }

  // Anti-enumeration case: with "Confirm email" ON (the live project's
  // *current* setting -- see the #9 issue comment on why this couldn't be
  // flipped programmatically here), Supabase's signUp() for an
  // *already-registered* email does NOT return an error -- it returns a
  // fabricated 200 response whose `identities` array is empty, so the
  // caller can't distinguish "new signup" from "existing user" without
  // this check. Once "Confirm email" is off, duplicate signups instead
  // return an explicit `user_already_exists` error (handled by
  // `mapRegisterError` above) -- this branch is a defensive fallback that
  // keeps the duplicate-email edge case correctly handled under either
  // setting.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return {
      formError: null,
      fieldErrors: { email: "This email is already registered" },
    };
  }

  if (!data.session) {
    // With "Confirm email" off (the setting this task requires), signUp()
    // above returns a session immediately and this branch never runs. It
    // only exists because that project setting could not be flipped
    // programmatically in this sandbox (see the #9 issue comment) --
    // rather than leave a freshly-created account stuck with no session
    // (and no "check your email" UI, which is explicitly out of scope for
    // this task), fall back to an immediate sign-in attempt with the same
    // credentials.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (signInError) {
      return {
        formError:
          "Your account was created, but automatic sign-in failed. Please try logging in.",
        fieldErrors: {},
      };
    }
  }

  redirect("/dashboard");
}

function mapRegisterError(error: AuthError): AuthFormState {
  if (error.code === "user_already_exists" || error.code === "email_exists") {
    return {
      formError: null,
      fieldErrors: { email: "This email is already registered" },
    };
  }
  if (error.code === "weak_password") {
    return { formError: null, fieldErrors: { password: error.message } };
  }
  return { formError: error.message, fieldErrors: {} };
}

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { formError: null, fieldErrors: zodFieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Single generic message regardless of *why* signInWithPassword failed
    // (wrong password vs. unknown email vs. anything else) -- matches
    // Supabase's own anti-enumeration behavior per the "Wrong password at
    // login" edge case: never confirm/deny whether an email is registered.
    return { formError: "Invalid email or password", fieldErrors: {} };
  }

  redirect("/dashboard");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function forgotPasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { formError: null, fieldErrors: zodFieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  const origin = await getSiteOrigin();

  try {
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${origin}/auth/confirm`,
    });
  } catch {
    // Swallowed deliberately -- see the comment below on the return value.
  }

  // Always the same generic confirmation, whether or not `parsed.data.email`
  // actually has an account and whether or not the call above errored: the
  // form must never reveal which emails are registered (per acceptance
  // criteria E).
  return {
    formError: null,
    fieldErrors: {},
    success: true,
  };
}

export async function resetPasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { formError: null, fieldErrors: zodFieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // No active (recovery) session -- either the link was never followed
    // successfully, or it expired between the page rendering and this
    // submission (the "recovery session expires mid-form" edge case).
    return {
      formError: "This link is invalid or has expired.",
      fieldErrors: {},
    };
  }

  try {
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });

    if (error) {
      if (error.code === "weak_password") {
        return { formError: null, fieldErrors: { password: error.message } };
      }
      if (error.code === "same_password") {
        return {
          formError: null,
          fieldErrors: {
            password: "New password must be different from the old password",
          },
        };
      }
      // Any other failure here (expired/invalid recovery session, etc.)
      // gets the same invalid/expired messaging as the missing-session case
      // above, per the issue's edge cases -- never a silent no-op.
      return {
        formError: "This link is invalid or has expired.",
        fieldErrors: {},
      };
    }
  } catch (caught) {
    if (isRedirectError(caught)) throw caught;
    return {
      formError: "This link is invalid or has expired.",
      fieldErrors: {},
    };
  }

  // Sign out the recovery session so the redirect below actually lands on
  // a *logged-out* /login page (otherwise AC C's "already authenticated"
  // redirect would bounce the user straight to /dashboard, skipping the
  // "log in with the new password" step the issue's manual verification
  // walkthrough calls for).
  await supabase.auth.signOut();
  redirect("/login");
}
