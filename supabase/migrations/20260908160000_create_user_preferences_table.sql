-- user_preferences: one row per user, holding cross-device UI preferences
-- (theme, last screen, default sort, list view mode).
--
-- Design record: _docs/database-schema.md §3 (columns/types) and §4 (RLS
-- model). Added by issue #8 so a theme toggle can persist a signed-in
-- user's choice server-side (syncing across devices) per
-- _docs/ui-style-guide.md §4. RLS is scoped directly by user_id (matching
-- public.items/public.lists), not the parent-table `exists` pattern used by
-- the relation tables -- user_preferences has no parent row to join through.
--
-- The `theme`/`list_view_mode` check constraints below aren't yet written
-- down in database-schema.md §3 as of this migration; a short note
-- documenting them was added there in the same change (see issue #8).

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text check (theme in ('light', 'dark')),
  last_screen text,
  default_sort text,
  list_view_mode text check (list_view_mode in ('list', 'card')),
  updated_at timestamptz not null default now()
);

comment on table public.user_preferences is
  'One row per user: theme/last-screen/default-sort/list-view-mode preferences, synced across devices (see database-schema.md §3).';

comment on column public.user_preferences.theme is
  '''light'' / ''dark'' / null (null = follow system preference).';

comment on column public.user_preferences.list_view_mode is
  '''list'' / ''card'' / null.';

-- ---------------------------------------------------------------------------
-- trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function public.user_preferences_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row
  execute function public.user_preferences_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: user_preferences
-- ---------------------------------------------------------------------------

alter table public.user_preferences enable row level security;

create policy "user_preferences_select_own"
  on public.user_preferences
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_preferences_insert_own"
  on public.user_preferences
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_preferences_update_own"
  on public.user_preferences
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_preferences_delete_own"
  on public.user_preferences
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.user_preferences to authenticated;
