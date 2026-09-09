-- Custom subtype creation support (issue #18): first app-facing create path
-- onto `public.subtypes`. Same shape as #17's tags migration
-- (20260909100000_add_tags_insert_policy_and_unique_index.sql), minus a new
-- unique index -- subtypes_category_lower_name_user_key already exists from
-- #3's original migration (20260908123222_create_reference_tables.sql).
--
-- Design record: _docs/database-schema.md §3 (subtypes) and §4 (RLS model).

-- ---------------------------------------------------------------------------
-- subtypes: tighten SELECT, add INSERT
-- ---------------------------------------------------------------------------

-- The existing subtypes_select_authenticated policy is `using (true)` --
-- fully open, which was harmless while every row was a seeded, globally-
-- visible predefined subtype. #18's acceptance criteria require a user's own
-- custom subtype to never be visible to another user (predefined
-- `user_id IS NULL` subtypes stay visible to everyone), so this replaces it
-- with the same ownership-or-predefined shape tags_select_authenticated
-- already uses post-#17.
drop policy "subtypes_select_authenticated" on public.subtypes;

create policy "subtypes_select_authenticated"
  on public.subtypes
  for select
  to authenticated
  using (user_id is null or user_id = auth.uid());

-- A signed-in user may only create a subtype owned by themselves -- never
-- NULL (that would fabricate a fake "predefined" subtype) and never another
-- user's id. Mirrors tags_insert_own.
create policy "subtypes_insert_own"
  on public.subtypes
  for insert
  to authenticated
  with check (user_id = auth.uid());

grant insert on public.subtypes to authenticated;

-- ---------------------------------------------------------------------------
-- items_check_subtype_category: close a gap the new subtypes visibility
-- policy above would otherwise leave open
-- ---------------------------------------------------------------------------

-- Same shape as #17's item_tags_insert_own fix. This trigger function
-- (20260908130000_create_items_table.sql) only ever checked that
-- subtype_id's category_id matches the item's category_id -- it never
-- checked that the subtype is actually *visible* to the item's owner. Once
-- private custom subtypes exist (this migration), a crafted insert/update
-- could set subtype_id to another user's private subtype (same category,
-- guessed/enumerated id) and it would pass both this trigger and
-- items_insert_own/items_update_own RLS, since neither checks subtype
-- ownership. Extending the exists check to also require the subtype be
-- predefined or owned by new.user_id closes this before it ships alongside
-- the first real custom subtypes.
create or replace function public.items_check_subtype_category()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.subtypes
    where id = new.subtype_id
      and category_id = new.category_id
      and (subtypes.user_id is null or subtypes.user_id = new.user_id)
  ) then
    raise exception 'subtype_id % does not belong to category_id % or is not visible to user_id %', new.subtype_id, new.category_id, new.user_id;
  end if;
  return new;
end;
$$;
