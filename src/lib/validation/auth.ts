import { z } from "zod";

// Shared Zod schemas for the auth forms (issue #9), used both client-side
// (blocking submission before any network call, per acceptance criteria B)
// and inside the Server Actions in `lib/actions/auth.ts` as the
// server-side re-check -- matches `lib/validation/`'s stated purpose in
// `project-structure.md` §4 of sharing validation between the two.
//
// These schemas intentionally do NOT enforce a minimum password length.
// The "weak password" case is left to Supabase's own configured minimum
// (verified live against this project: 6 characters, returned as an
// `weak_password` AuthError) so the error message shown to the user always
// matches whatever the live project is actually configured with, rather
// than a value hardcoded here going stale -- see the "Weak password at
// registration" edge case in the issue.

const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address");

// Login only checks presence, not shape/strength -- an incorrect password
// is Supabase's problem to reject (surfaced as the generic "Invalid email
// or password" edge case), not this schema's.
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, "Password is required"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: z.string().min(1, "Password is required"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Shared result shape for every auth Server Action in `lib/actions/auth.ts`,
// consumed via `useActionState` in the matching *Form.tsx client component.
// Lives here rather than in auth.ts itself because a "use server" file may
// only export async functions -- a type/object export there fails the build
// ("A 'use server' file can only export async functions, found object").
//   - `formError` is a page-level/generic message (e.g. "Invalid email or
//     password", per the login edge case's anti-enumeration requirement).
//   - `fieldErrors` keys match the form's field names, for inline errors
//     (client-side Zod failures AND server-surfaced Supabase errors, e.g.
//     "This email is already registered" / a weak-password message, land
//     in the same shape so the form doesn't need two rendering paths).
export type AuthFormState = {
  formError: string | null;
  fieldErrors: Record<string, string>;
  success?: boolean;
};

export const initialAuthFormState: AuthFormState = {
  formError: null,
  fieldErrors: {},
};
