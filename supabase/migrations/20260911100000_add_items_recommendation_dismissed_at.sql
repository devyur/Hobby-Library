-- items.recommendation_dismissed_at: per-item dismiss state for Dashboard
-- Recommendations (issue #44). Same soft-state pattern items.deleted_at/
-- items.completed_at already use (migration 20260908130000): a single
-- nullable timestamptz, non-null meaning "dismissed", set/cleared by plain
-- UPDATE statements rather than a delete/insert into a separate table.
--
-- Design record: _docs/database-schema.md §3 (items table), _docs/plan.md
-- §14 (Recommendations).
--
-- Keyed purely by the item's own id/row -- a dismissed item that's later
-- deleted and replaced by a new, separate row (even an identical title/
-- category) is never treated as already dismissed, since the new row is a
-- distinct primary key with its own (null) recommendation_dismissed_at.
-- Survives the item's own status changes (Planned -> Ongoing -> Planned
-- again) for the same reason: nothing here is derived from status.
--
-- No new RLS policies or grants: `items`' existing per-user RLS
-- (items_select_own/items_update_own, migration 20260908130000) and grants
-- already cover reads/writes to this new column like any other `items`
-- column -- a new child table would have needed its own RLS, which is
-- exactly the extra cost this single-column approach avoids (per this
-- issue's own Constraints).

alter table public.items
  add column recommendation_dismissed_at timestamptz null default null;

comment on column public.items.recommendation_dismissed_at is
  'Non-null means this item is dismissed from Dashboard Recommendations (issue #44) -- excluded from every recommendation query (Recommended Planned, Random pick, Continue) via .is("recommendation_dismissed_at", null). Set/cleared directly by dismissRecommendationAction/undismissRecommendationAction (lib/actions/recommendations.ts); independent of status/deleted_at, so a status change or a later un-delete never implicitly reinstates or re-dismisses it.';
