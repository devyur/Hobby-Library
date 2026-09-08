import type { Database } from "./supabase/types";

// Static display lookups not worth a DB round-trip (project-structure.md
// §4's stated purpose for lib/constants.ts). First consumer: issue #12's
// StatusPill/PriorityBadge components.

type ItemStatus = Database["public"]["Enums"]["item_status"];
type PriorityLevel = Database["public"]["Enums"]["priority_level"];

export const STATUS_LABELS: Record<ItemStatus, string> = {
  planned: "Planned",
  ongoing: "Ongoing",
  completed: "Completed",
  dropped: "Dropped",
};

// Tailwind utility class pairs per status, resolving to the CSS
// variable-backed tokens defined in globals.css (ui-style-guide.md §1's
// Status colors table -- these class names come from the `@theme inline`
// mapping there, e.g. `bg-status-planned-bg`).
export const STATUS_BADGE_CLASSES: Record<ItemStatus, string> = {
  planned: "bg-status-planned-bg text-status-planned-text",
  ongoing: "bg-status-ongoing-bg text-status-ongoing-text",
  completed: "bg-status-completed-bg text-status-completed-text",
  dropped: "bg-status-dropped-bg text-status-dropped-text",
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
