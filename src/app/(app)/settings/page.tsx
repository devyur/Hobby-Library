// Trivial stub (issue #10, acceptance criteria C) -- real content (account
// email, sign-out, theme toggle) is #11's job. Exists so /settings is a
// real route inside the shell rather than a 404.
export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-2 px-6 py-8">
      <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
      <p className="text-sm text-text-secondary">Settings — coming in #11.</p>
    </div>
  );
}
