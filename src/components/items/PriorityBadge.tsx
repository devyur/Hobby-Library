import { PRIORITY_LABELS } from "@/lib/constants";
import type { Database } from "@/lib/supabase/types";

type ItemStatus = Database["public"]["Enums"]["item_status"];
type PriorityLevel = Database["public"]["Enums"]["priority_level"];

// Priority badge (issue #12). The "only when relevant" rule -- shown only
// for planned items with a non-null priority (plan.md §12: priority is
// pre-consumption only) -- lives here as the single source of truth, rather
// than being duplicated in every caller (ItemListRow, ItemCard).
export function PriorityBadge({
  status,
  priority,
}: {
  status: ItemStatus;
  priority: PriorityLevel | null;
}) {
  if (status !== "planned" || priority === null) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border px-2 py-0.5 text-xs font-medium text-text-secondary">
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
