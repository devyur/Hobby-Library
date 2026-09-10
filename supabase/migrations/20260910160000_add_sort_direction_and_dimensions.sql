-- Sort: direction toggle + additional dimensions (issue #39, #40 folded in).
-- Extends #24's Sort control (recently_added/priority/status, one fixed
-- direction each) with two more dimensions (rating, title) and a direction
-- toggle that applies to whichever dimension is currently selected.
--
-- Design record: _docs/database-schema.md §3, _docs/plan.md §13.

-- ---------------------------------------------------------------------------
-- default_sort: extend the check constraint (migration 20260909160000) to
-- accept the two new dimensions. Same `column in (...)` shape, just a wider
-- value list -- values already in use (recently_added/priority/status) are
-- untouched.
-- ---------------------------------------------------------------------------

alter table public.user_preferences
  drop constraint user_preferences_default_sort_check;

alter table public.user_preferences
  add constraint user_preferences_default_sort_check
  check (default_sort in ('recently_added', 'priority', 'status', 'rating', 'title'));

comment on column public.user_preferences.default_sort is
  '''recently_added'' / ''priority'' / ''status'' / ''rating'' / ''title'' / null (null behaves as ''recently_added'', the default). See plan.md §13 for what each value orders by.';

-- ---------------------------------------------------------------------------
-- default_sort_direction: a single column applied to whichever dimension
-- default_sort currently names -- not a doubled enum (no
-- priority_asc/priority_desc-style values on default_sort itself) and not
-- per-dimension storage (no five separate direction columns), per this
-- issue's own constraint. `null` means "use the selected dimension's
-- natural default direction" -- same null-means-default convention
-- default_sort itself already uses. 'asc'/'desc' is a raw two-value flag;
-- what it means for the *currently selected* dimension (a real ascending/
-- descending scale for recently_added/rating/title, a reversal of a fixed
-- bucket order for priority/status, which has no inherent "greater/lesser"
-- scale) is entirely an application-layer concern -- see
-- getLibraryItems'/LibraryView.tsx's own comments (lib/queries/items.ts,
-- components/items/LibraryView.tsx).
-- ---------------------------------------------------------------------------

alter table public.user_preferences
  add column default_sort_direction text;

alter table public.user_preferences
  add constraint user_preferences_default_sort_direction_check
  check (default_sort_direction in ('asc', 'desc'));

comment on column public.user_preferences.default_sort_direction is
  '''asc'' / ''desc'' / null (null = the selected default_sort dimension''s own natural default direction). Applies to whichever dimension default_sort currently names. See plan.md §13.';

-- ---------------------------------------------------------------------------
-- item_priority_rank_reverse: the direction-aware companion to
-- item_priority_rank (migration 20260909160000, left unchanged so the
-- existing default High -> Low behavior is untouched by this migration).
-- Low -> High order for the Priority sort's reversed direction, with
-- "no priority set" pinned to the same last-place rank (4) in both
-- functions -- flipping direction must reverse only the High/Medium/Low
-- order, never move "unset" out of last place (this issue's own acceptance
-- criteria).
-- ---------------------------------------------------------------------------

create or replace function public.item_priority_rank_reverse(item public.items)
returns integer
language sql
immutable
security invoker
as $$
  select case item.priority
    when 'low' then 1
    when 'medium' then 2
    when 'high' then 3
    else 4
  end;
$$;

comment on function public.item_priority_rank_reverse(public.items) is
  'Sort rank for Priority sort''s reversed direction (#39): low=1, medium=2, high=3, no priority set=4 (still last). Used via getLibraryItems'' .order("item_priority_rank_reverse", ...) when default_sort_direction resolves to the "Low -> High" state.';

grant execute on function public.item_priority_rank_reverse(public.items) to authenticated;

-- ---------------------------------------------------------------------------
-- item_title_sort_key: case-insensitive sort key for the new Title
-- dimension -- Postgres' default column collation isn't guaranteed to
-- interleave "apple"/"Banana"/"cherry" purely by letter (this issue's own
-- acceptance criteria), so this pins the comparison to lower(title)
-- explicitly rather than relying on the `items.title` column's own
-- collation. Same `language sql` + `security invoker` computed-field
-- pattern as item_priority_rank/item_status_rank above.
-- ---------------------------------------------------------------------------

create or replace function public.item_title_sort_key(item public.items)
returns text
language sql
immutable
security invoker
as $$
  select lower(item.title);
$$;

comment on function public.item_title_sort_key(public.items) is
  'Case-insensitive sort key for the Title sort (#39): lower(title). Used via getLibraryItems'' .order("item_title_sort_key", ...) as a PostgREST computed field.';

grant execute on function public.item_title_sort_key(public.items) to authenticated;
