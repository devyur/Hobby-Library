-- Item relation tables: item_tags, item_images, item_links, item_attachments
--
-- Design record: _docs/database-schema.md §3 (columns/types) and §4 (RLS model).
-- None of these tables carries its own user_id column, so every RLS policy scopes
-- through the parent item's owner via an `exists` check against public.items
-- (items.id = <table>.item_id and items.user_id = auth.uid()). References
-- public.items / public.tags from 20260908130000_create_items_table.sql and
-- 20260908123222_create_reference_tables.sql via foreign keys only.

-- ---------------------------------------------------------------------------
-- item_tags
-- ---------------------------------------------------------------------------

create table public.item_tags (
  item_id uuid not null references public.items (id) on delete cascade,
  tag_id uuid not null references public.tags (id),
  primary key (item_id, tag_id)
);

comment on table public.item_tags is
  'Junction table assigning tags to items. No surrogate id column; primary key is (item_id, tag_id).';

create index item_tags_item_id_idx on public.item_tags (item_id);
create index item_tags_tag_id_idx on public.item_tags (tag_id);

alter table public.item_tags enable row level security;

create policy "item_tags_select_own"
  on public.item_tags
  for select
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_tags.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_tags_insert_own"
  on public.item_tags
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.items
      where items.id = item_tags.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_tags_update_own"
  on public.item_tags
  for update
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_tags.item_id
        and items.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.items
      where items.id = item_tags.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_tags_delete_own"
  on public.item_tags
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_tags.item_id
        and items.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.item_tags to authenticated;

-- ---------------------------------------------------------------------------
-- item_images
-- ---------------------------------------------------------------------------

create table public.item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  storage_path text not null,
  is_cover boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.item_images is
  'Images attached to an item (cover + gallery). At most one is_cover = true row per item, enforced by item_images_one_cover_per_item_key.';

create index item_images_item_id_idx on public.item_images (item_id);

-- Partial unique index: at most one is_cover = true row per item_id. Rows with
-- is_cover = false are unconstrained (multiple allowed per item).
create unique index item_images_one_cover_per_item_key
  on public.item_images (item_id)
  where is_cover;

alter table public.item_images enable row level security;

create policy "item_images_select_own"
  on public.item_images
  for select
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_images.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_images_insert_own"
  on public.item_images
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.items
      where items.id = item_images.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_images_update_own"
  on public.item_images
  for update
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_images.item_id
        and items.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.items
      where items.id = item_images.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_images_delete_own"
  on public.item_images
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_images.item_id
        and items.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.item_images to authenticated;

-- ---------------------------------------------------------------------------
-- item_links
-- ---------------------------------------------------------------------------

create table public.item_links (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  url text not null,
  label text,
  created_at timestamptz not null default now()
);

comment on table public.item_links is
  'External reference links attached to an item (e.g. store page, IMDb).';

create index item_links_item_id_idx on public.item_links (item_id);

alter table public.item_links enable row level security;

create policy "item_links_select_own"
  on public.item_links
  for select
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_links.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_links_insert_own"
  on public.item_links
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.items
      where items.id = item_links.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_links_update_own"
  on public.item_links
  for update
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_links.item_id
        and items.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.items
      where items.id = item_links.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_links_delete_own"
  on public.item_links
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_links.item_id
        and items.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.item_links to authenticated;

-- ---------------------------------------------------------------------------
-- item_attachments
-- ---------------------------------------------------------------------------

create table public.item_attachments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

comment on table public.item_attachments is
  'Uploaded reference files attached to an item. Allowed types/size caps are enforced at the application/upload layer and Storage bucket policy, not here.';

create index item_attachments_item_id_idx on public.item_attachments (item_id);

alter table public.item_attachments enable row level security;

create policy "item_attachments_select_own"
  on public.item_attachments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_attachments.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_attachments_insert_own"
  on public.item_attachments
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.items
      where items.id = item_attachments.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_attachments_update_own"
  on public.item_attachments
  for update
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_attachments.item_id
        and items.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.items
      where items.id = item_attachments.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "item_attachments_delete_own"
  on public.item_attachments
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.items
      where items.id = item_attachments.item_id
        and items.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.item_attachments to authenticated;
