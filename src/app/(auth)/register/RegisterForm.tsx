"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerAction } from "@/lib/actions/auth";
import { initialAuthFormState, registerSchema } from "@/lib/validation/auth";

// Client-side Zod validation blocks submission (before any network call) on
// an empty/malformed email, empty password, or password/confirm-password
// mismatch -- issue #9 acceptance criteria B. Weak-password rejection is
// deliberately NOT checked here: that error comes back from Supabase
// (surfaced via `state.fieldErrors.password`) so the message always matches
// whatever minimum this project is actually configured with, rather than a
// value hardcoded client-side (see the "Weak password" edge case).
export function RegisterForm() {
  const [state, formAction, isPending] = useActionState(
    registerAction,
    initialAuthFormState,
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>(
    {},
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });

    if (!parsed.success) {
      event.preventDefault();
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
      }
      setClientErrors(errors);
      return;
    }

    setClientErrors({});
  }

  const fieldErrors = { ...state.fieldErrors, ...clientErrors };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Register</h1>
        <p className="text-sm text-text-secondary">
          Create your Hobby Library account.
        </p>
      </div>

      <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {state.formError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.formError}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
          />
          {fieldErrors.email ? (
            <p id="email-error" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
          />
          {fieldErrors.password ? (
            <p id="password-error" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!fieldErrors.confirmPassword}
            aria-describedby={
              fieldErrors.confirmPassword ? "confirm-password-error" : undefined
            }
          />
          {fieldErrors.confirmPassword ? (
            <p
              id="confirm-password-error"
              className="text-sm text-red-600 dark:text-red-400"
            >
              {fieldErrors.confirmPassword}
            </p>
          ) : null}
        </div>

        <Button type="submit" disabled={isPending} className="mt-2">
          {isPending ? "Creating account..." : "Register"}
        </Button>
      </form>

      <p className="text-sm text-text-secondary">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
