// Suspense fallback for every route under the (app) group (issue #59).
// Colocated with layout.tsx, so Next.js wraps that layout's {children} in a
// <Suspense> boundary -- NavShell's sidebar/mobile top bar (rendered outside
// {children}, see NavShell.tsx) stay mounted and interactive; only the
// content inside <main> swaps to this fallback while a page's Server
// Component data is fetching. No new request is introduced: this suspends
// on the same per-page fetch that already runs (e.g. getDashboardData()),
// nothing additional is awaited here.
//
// A single top-level file is correct -- no segment under (app) has its own
// layout.tsx, so there is no case where a different shell needs preserving.
// See the issue for the full reasoning.
export default function AppLoading() {
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>,
          not next/image: its optimizer can freeze an animated GIF to a
          static first frame unless explicitly marked unoptimized. */}
      <img
        src="/dragon-loading.gif"
        alt=""
        width={96}
        height={96}
        className="h-24 w-24"
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
