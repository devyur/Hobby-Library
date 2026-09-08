// Bare placeholder layout (issue #9 acceptance criteria A) -- explicitly
// NOT the real app shell. #10 replaces this with the nav shell described in
// plan.md §15 (Dashboard, category tabs, Custom Lists, Trash, Settings).
// This exists only so middleware.ts has something to protect and a
// logged-in user has somewhere to land.
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex flex-1 flex-col bg-bg text-text-primary">{children}</div>;
}
