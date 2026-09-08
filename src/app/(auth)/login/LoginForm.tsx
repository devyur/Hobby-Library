"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/lib/actions/auth";
import { initialAuthFormState, loginSchema } from "@/lib/validation/auth";

// Client-side Zod validation runs in `onSubmit`, before the Server Action
// ever fires: `event.preventDefault()` on a validation failure stops
// `formAction` (React 19's <form action={...}> only invokes the action if
// `onSubmit` doesn't call preventDefault) and instead surfaces inline
// field errors, matching the "before any network call" requirement (issue
// #9 acceptance criteria B, applied here to login too for consistency).
export function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    loginAction,
    initialAuthFormState,
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>(
    {},
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
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
        <h1 className="text-lg font-semibold text-text-primary">Log in</h1>
        <p className="text-sm text-text-secondary">
          Welcome back to Hobby Library.
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
            autoComplete="current-password"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
          />
          {fieldErrors.password ? (
            <p id="password-error" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        <Link href="/forgot-password" className="self-start text-sm text-accent hover:underline">
          Forgot password?
        </Link>

        <Button type="submit" disabled={isPending} className="mt-2">
          {isPending ? "Logging in..." : "Log in"}
        </Button>
      </form>

      <p className="text-sm text-text-secondary">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-accent hover:underline">
          Register
        </Link>
      </p>
    </div>
  );
}
