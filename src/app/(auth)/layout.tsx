// Shared layout for the public auth pages (login/register/forgot-password/
// reset-password) -- issue #9 acceptance criteria (A). Centers a single
// card using the --bg/--surface/--border tokens from #8's globals.css; no
// nav, since there's nothing to navigate to while logged out (the root
// layout in src/app/layout.tsx already supplies <html>/<body>, fonts, and
// pre-paint theme resolution -- this layout only adds the card shell).
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
