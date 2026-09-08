import { ForgotPasswordForm } from "./ForgotPasswordForm";

// No server-side auth-redirect check here (unlike login/register): a
// signed-in user requesting a password reset for a *different* account is
// a reasonable thing to allow, and the issue's acceptance criteria only
// require the redirect-when-authenticated behavior for /login and
// /register.
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
