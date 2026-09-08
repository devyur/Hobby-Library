"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "@/lib/actions/auth";
import { initialAuthFormState, resetPasswordSchema } from "@/lib/validation/auth";

export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    resetPasswordAction,
    initialAuthFormState,
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>(
    {},
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const parsed = resetPasswordSchema.safeParse({
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

  // The recovery session can still expire between this page rendering and
  // the form being submitted (the "recovery session expires mid-form" edge
  // case) -- resetPasswordAction returns the same invalid/expired message
  // as the page-level check in page.tsx for that case, shown here as a
  // page-level error rather than a field error.
  if (state.formError) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-text-primary">
          Link invalid or expired
        </h1>
        <p role="alert" className="text-sm text-text-secondary">
          {state.formError}
        </p>
        <Link href="/forgot-password" className="text-sm text-accent hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">
          Set a new password
        </h1>
        <p className="text-sm text-text-secondary">
          Choose a new password for your account.
        </p>
      </div>

      <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">New password</Label>
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
          <Label htmlFor="confirmPassword">Confirm new password</Label>
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
          {isPending ? "Saving..." : "Save new password"}
        </Button>
      </form>
    </div>
  );
}
