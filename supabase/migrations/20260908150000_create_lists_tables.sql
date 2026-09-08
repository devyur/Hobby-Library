-- Custom lists tables: lists, list_items
--
-- Design record: _docs/database-schema.md §3 (columns/types) and §4 (RLS model).
-- lists carries its own user_id, RLS scoped directly (matching public.items).
-- list_items has no user_id column; RLS scopes through the parent list's owner
-- via an `exists` check against public.lists (lists.id = list_items.list_id and
-- lists.user_id = auth.uid()), matching the pattern used for item_tags/item_images/
-- item_links/item_attachments in 20260908140000_create_item_relations_tables.sql.
-- The list_items insert/update policies additionally require the referenced
-- item_id to belong to the same user (exists against public.items), so a user
-- cannot add another user's item into their own list. References public.items
-- from 20260908130000_create_items_table.sql via foreign key only.

-- ---------------------------------------------------------------------------
-- lists
-- ---------------------------------------------------------------------------

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lists is
  'User-created custom lists (manually managed collections of items; see database-schema.md §3).';

create index lists_user_id_idx on public.lists (user_id);

-- ---------------------------------------------------------------------------
-- trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function public.lists_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lists_set_updated_at
  before update on public.lists
  for each row
  execute function public.lists_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: lists
-- ---------------------------------------------------------------------------

alter table public.lists enable row level security;

create policy "lists_select_own"
  on public.lists
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "lists_insert_own"
  on public.lists
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "lists_update_own"
  on public.lists
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "lists_delete_own"
  on public.lists
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.lists to authenticated;

-- ---------------------------------------------------------------------------
-- list_items
-- ---------------------------------------------------------------------------

create table public.list_items (
  list_id uuid not null references public.lists (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  sort_order integer not null default 0,
  added_at timestamptz not null default now(),
  primary key (list_id, item_id)
);

comment on table public.list_items is
  'Junction table assigning items to lists. No surrogate id column; primary key is (list_id, item_id).';

create index list_items_list_id_idx on public.list_items (list_id);
create index list_items_item_id_idx on public.list_items (item_id);

alter table public.list_items enable row level security;

create policy "list_items_select_own"
  on public.list_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.lists
      where lists.id = list_items.list_id
        and lists.user_id = auth.uid()
    )
  );

create policy "list_items_insert_own"
  on public.list_items
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.lists
      where lists.id = list_items.list_id
        and lists.user_id = auth.uid()
    )
    and exists (
      select 1 from public.items
      where items.id = list_items.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "list_items_update_own"
  on public.list_items
  for update
  to authenticated
  using (
    exists (
      select 1 from public.lists
      where lists.id = list_items.list_id
        and lists.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lists
      where lists.id = list_items.list_id
        and lists.user_id = auth.uid()
    )
    and exists (
      select 1 from public.items
      where items.id = list_items.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "list_items_delete_own"
  on public.list_items
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.lists
      where lists.id = list_items.list_id
        and lists.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.list_items to authenticated;
