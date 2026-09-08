-- Reference tables: categories, subtypes, tags
--
-- Design record: _docs/database-schema.md §3 (columns/types) and §4 (RLS model).
-- categories: fixed lookup table for the 4 V1 top-level categories (Games/Books/Audio/Video).
-- subtypes / tags: predefined (user_id IS NULL, seeded) rows plus room for user-created
-- custom rows (user_id set) later — no app-facing create flow is built in this task.

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.categories is
  'Top-level library categories (Games/Books/Audio/Video for V1). Not user-editable in V1 — admin/seed-managed.';

alter table public.categories enable row level security;

create policy "categories_select_authenticated"
  on public.categories
  for select
  to authenticated
  using (true);

grant select on public.categories to authenticated;

-- ---------------------------------------------------------------------------
-- subtypes
-- ---------------------------------------------------------------------------

create table public.subtypes (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  name text not null,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.subtypes is
  'Subtypes within a category. user_id IS NULL = global predefined subtype (seeded); set = a user''s custom subtype.';

create index subtypes_category_id_idx on public.subtypes (category_id);
create index subtypes_user_id_idx on public.subtypes (user_id);

-- Unique per (category_id, lower(name), user_id) to prevent duplicates within the same
-- scope (a user's own custom subtypes, or — since NULL user_id is itself the "global"
-- scope — the predefined/seeded rows). NULLS NOT DISTINCT makes two NULL user_id rows
-- collide for this purpose, matching the documented intent in database-schema.md §3.
create unique index subtypes_category_lower_name_user_key
  on public.subtypes (category_id, lower(name), user_id)
  nulls not distinct;

alter table public.subtypes enable row level security;

create policy "subtypes_select_authenticated"
  on public.subtypes
  for select
  to authenticated
  using (true);

grant select on public.subtypes to authenticated;

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.tags is
  'Global (not category-scoped) tags. user_id IS NULL = global predefined tag; set = a user''s custom tag.';

create index tags_user_id_idx on public.tags (user_id);

alter table public.tags enable row level security;

create policy "tags_select_authenticated"
  on public.tags
  for select
  to authenticated
  using (true);

grant select on public.tags to authenticated;
