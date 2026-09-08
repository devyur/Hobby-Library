-- items table: the core row for every library entry (game/book/audio/video).
--
-- Design record: _docs/database-schema.md §3 (columns/types) and §4 (RLS model).
-- Adds the item_status / priority_level enums, the items table itself, a trigger
-- enforcing that subtype_id belongs to category_id, an updated_at-maintenance
-- trigger, and per-user RLS policies. References public.categories / public.subtypes
-- from 20260908123222_create_reference_tables.sql via foreign keys only.

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------

create type public.item_status as enum ('planned', 'ongoing', 'completed', 'dropped');

create type public.priority_level as enum ('low', 'medium', 'high');

-- ---------------------------------------------------------------------------
-- items
-- ---------------------------------------------------------------------------

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  category_id uuid not null references public.categories (id),
  subtype_id uuid not null references public.subtypes (id),
  status public.item_status not null default 'planned',
  priority public.priority_level,
  rating smallint,
  notes text,
  review text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  constraint items_rating_check check (rating is null or rating between 1 and 10)
);

comment on table public.items is
  'Core library entries: one row per item a user is tracking. Soft-deleted via deleted_at (see database-schema.md §9).';

create index items_category_id_idx on public.items (category_id);
create index items_subtype_id_idx on public.items (subtype_id);
create index items_user_id_idx on public.items (user_id);

-- ---------------------------------------------------------------------------
-- trigger: subtype_id must belong to category_id
-- ---------------------------------------------------------------------------
-- Postgres foreign keys can't cross-check a second column directly, so this is
-- enforced with a BEFORE INSERT OR UPDATE trigger instead (per database-schema.md §3).

create function public.items_check_subtype_category()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.subtypes
    where id = new.subtype_id
      and category_id = new.category_id
  ) then
    raise exception 'subtype_id % does not belong to category_id %', new.subtype_id, new.category_id;
  end if;
  return new;
end;
$$;

create trigger items_check_subtype_category
  before insert or update on public.items
  for each row
  execute function public.items_check_subtype_category();

-- ---------------------------------------------------------------------------
-- trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function public.items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger items_set_updated_at
  before update on public.items
  for each row
  execute function public.items_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.items enable row level security;

create policy "items_select_own"
  on public.items
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "items_insert_own"
  on public.items
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "items_update_own"
  on public.items
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "items_delete_own"
  on public.items
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.items to authenticated;
