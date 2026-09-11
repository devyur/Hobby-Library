"use client";

import { useSyncExternalStore } from "react";

import { formatDate, formatDateOnly } from "@/lib/format";

// Renders a genuine timestamp (created_at, deleted_at) via formatDate() --
// i.e. in the *viewer's* local timezone, which is correct by design for
// these fields (see format.ts's own comment on formatDate vs.
// formatDateOnly) -- without the React hydration mismatch that a direct
// {formatDate(iso)} call produces in a component that both server-renders
// and client-hydrates (issue #46). The mismatch is real, not cosmetic: the
// server renders using its own local timezone's notion of "now", the client
// hydrates using the *viewer's* local timezone, and near a local-midnight
// boundary in either timezone those two renders can land on different
// calendar dates for the same iso instant -- React then flags a genuine
// content mismatch between the server HTML and the client's first render.
//
// Standard Next.js/React fix for "value that's only safe to render once
// hydrated": don't render the local-time-sensitive value during SSR/the
// client's first render at all. Server and client agree on a stable
// placeholder for that first paint -- this uses formatDateOnly()'s
// UTC-forced formatting, which (unlike formatDate()) is a pure function of
// `iso` alone, independent of either side's host timezone, so server HTML
// and the client's first render always produce the identical string. Then,
// once hydration has completed, the real formatDate() value is swapped in.
//
// Same useSyncExternalStore "hydrated" idiom ThemeToggle.tsx already uses
// for the same class of problem (see its own comment): getServerSnapshot
// supplies the placeholder for SSR *and* the client's first render (so
// hydration never disagrees), then React re-renders with getSnapshot's
// "true" once mounted. No subscription is needed since nothing external
// ever changes post-mount -- subscribe is a no-op. This is preferred over a
// useState+useEffect "mounted" flag: that shape calls setState from inside
// an effect purely to force the one extra render hydration itself already
// triggers, which is exactly the cascading-render pattern
// react-hooks/set-state-in-effect flags.
function subscribe() {
  return () => {};
}

function getSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

export function LocalDate({ iso }: { iso: string }) {
  const hydrated = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return <>{hydrated ? formatDate(iso) : formatDateOnly(iso)}</>;
}
