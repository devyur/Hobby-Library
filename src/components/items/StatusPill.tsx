import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/constants";
import type { Database } from "@/lib/supabase/types";

type ItemStatus = Database["public"]["Enums"]["item_status"];

// Status pill (issue #12), colored per the Status colors table in
// ui-style-guide.md §1.
export function StatusPill({ status }: { status: ItemStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
