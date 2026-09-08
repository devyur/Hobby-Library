"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPasswordAction } from "@/lib/actions/auth";
import { forgotPasswordSchema, initialAuthFormState } from "@/lib/validation/auth";

// Issue #9 acceptance criteria E: the confirmation message shown after
// submitting must be identical whether or not `email` actually has an
// account -- `forgotPasswordAction` in lib/actions/auth.ts always returns
// `success: true` with no field-level detail, so there is nothing here
// that could leak which emails are registered.
export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    forgotPasswordAction,
    initialAuthFormState,
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>(
    {},
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const parsed = forgotPasswordSchema.safeParse({
      email: formData.get("email"),
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

  if (state.success) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-text-primary">
          Check your email
        </h1>
        <p className="text-sm text-text-secondary">
          If an account exists for that email, we&apos;ve sent a reset link.
        </p>
        <Link href="/login" className="text-sm text-accent hover:underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">
          Forgot password
        </h1>
        <p className="text-sm text-text-secondary">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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

        <Button type="submit" disabled={isPending} className="mt-2">
          {isPending ? "Sending..." : "Send reset link"}
        </Button>
      </form>

      <p className="text-sm text-text-secondary">
        <Link href="/login" className="text-accent hover:underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
