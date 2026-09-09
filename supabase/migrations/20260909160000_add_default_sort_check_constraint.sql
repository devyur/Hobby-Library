-- Sorting + remembered preference (issue #24): adds the check constraint
-- database-schema.md §3 left as a deferred TODO on `user_preferences.
-- default_sort` ("left unconstrained... #24 defines it") when that column
-- was first created (migration 20260908160000, issue #8) -- this task is
-- what finally defines its value set, so it lands here rather than being
-- deferred again. Same `column in (...)` shape as the existing theme/
-- list_view_mode constraints in that same migration.
--
-- Also adds two PostgREST "computed field" functions (a function taking a
-- table's own composite row type as its sole argument, which PostgREST then
-- exposes as a virtual column of that table -- usable in `.order()` the same
-- as a real column: https://postgrest.org/en/stable/references/api/
-- computed_fields.html). This is what lets getLibraryItems
-- (lib/queries/items.ts) express "High -> Medium -> Low -> no priority" /
-- "Ongoing -> Planned -> Completed -> Dropped" as a Postgres-side `CASE ...`
-- rank in the query's own ORDER BY, per this issue's own constraint that
-- Priority/Status ordering must not be fetched unsorted and reordered in JS.
--
-- Design record: _docs/database-schema.md §3, _docs/plan.md §13.

alter table public.user_preferences
  add constraint user_preferences_default_sort_check
  check (default_sort in ('recently_added', 'priority', 'status'));

comment on column public.user_preferences.default_sort is
  '''recently_added'' / ''priority'' / ''status'' / null (null behaves as ''recently_added'', the default). See plan.md §13 for what each value orders by.';

-- ---------------------------------------------------------------------------
-- item_priority_rank / item_status_rank: computed-field sort ranks for the
-- Priority/Status sort options. Plain `language sql` + `security invoker`,
-- same convention search_item_ids (migration 20260909150000) already
-- established: runs with the calling user's own privileges. Neither
-- function actually touches a table (both read only their own row
-- argument), so RLS isn't even a consideration here -- unlike
-- search_item_ids, which explicitly relies on `security invoker` to keep
-- items_select_own's RLS in effect.
-- ---------------------------------------------------------------------------

create or replace function public.item_priority_rank(item public.items)
returns integer
language sql
immutable
security invoker
as $$
  select case item.priority
    when 'high' then 1
    when 'medium' then 2
    when 'low' then 3
    else 4
  end;
$$;

comment on function public.item_priority_rank(public.items) is
  'Sort rank for Priority sort (#24): high=1, medium=2, low=3, no priority set=4 (last). Used via getLibraryItems'' .order("item_priority_rank", ...) as a PostgREST computed field.';

create or replace function public.item_status_rank(item public.items)
returns integer
language sql
immutable
security invoker
as $$
  select case item.status
    when 'ongoing' then 1
    when 'planned' then 2
    when 'completed' then 3
    when 'dropped' then 4
  end;
$$;

comment on function public.item_status_rank(public.items) is
  'Sort rank for Status sort (#24): ongoing=1, planned=2, completed=3, dropped=4. Used via getLibraryItems'' .order("item_status_rank", ...) as a PostgREST computed field.';

grant execute on function public.item_priority_rank(public.items) to authenticated;
grant execute on function public.item_status_rank(public.items) to authenticated;
