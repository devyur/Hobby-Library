-- Tag creation support (issue #17): first app-facing create path onto
-- `public.tags`. Adds what 20260908123222_create_reference_tables.sql
-- deliberately left out (no create path existed yet at #3): an INSERT
-- policy/grant, and a case-insensitive uniqueness guard mirroring
-- subtypes_category_lower_name_user_key.
--
-- Design record: _docs/database-schema.md §3 (tags) and §4 (RLS model).

-- ---------------------------------------------------------------------------
-- tags: tighten SELECT, add INSERT
-- ---------------------------------------------------------------------------

-- The existing tags_select_authenticated policy is `using (true)` -- fully
-- open, which was harmless while every row was a seeded, globally-visible
-- predefined tag. #17's acceptance criteria require a user's own custom tag
-- to never be visible to another user (predefined `user_id IS NULL` tags
-- stay visible to everyone), so this replaces it with the same
-- ownership-or-predefined shape item_tags/item_images/etc. already use.
drop policy "tags_select_authenticated" on public.tags;

create policy "tags_select_authenticated"
  on public.tags
  for select
  to authenticated
  using (user_id is null or user_id = auth.uid());

-- A signed-in user may only create a tag owned by themselves -- never NULL
-- (that would fabricate a fake "predefined" tag) and never another user's id.
create policy "tags_insert_own"
  on public.tags
  for insert
  to authenticated
  with check (user_id = auth.uid());

grant insert on public.tags to authenticated;

-- Case-insensitive uniqueness guard, mirroring
-- subtypes_category_lower_name_user_key above: a unique index on
-- (lower(name), user_id) with NULLS NOT DISTINCT, so two concurrent requests
-- can't create two tags differing only by case for the same user (or two
-- duplicate predefined rows, since NULLS NOT DISTINCT makes two NULL user_id
-- rows collide too). This does NOT by itself stop a custom tag from
-- duplicating a predefined tag's name, since they have different user_id
-- values and therefore differ as an index tuple -- that cross-scope case is
-- prevented only by the application-level lookup-before-create check in
-- src/lib/actions/tags.ts (addTagToItemAction).
create unique index tags_lower_name_user_key
  on public.tags (lower(name), user_id)
  nulls not distinct;

-- ---------------------------------------------------------------------------
-- item_tags: close a gap the new tags visibility policy above would
-- otherwise leave open
-- ---------------------------------------------------------------------------

-- Deviation from this issue's stated constraint ("item_tags's RLS policies
-- ... already exist in full from #5 -- no changes needed there"): that
-- assumption held only because, before this migration, every tags row was
-- visible to every user anyway. item_tags_insert_own (20260908140000) checks
-- only that the *item* belongs to the caller -- it never checked the *tag*.
-- Once a user can own a private tag (this migration), that gap means any
-- authenticated user could attach another user's private tag to their own
-- item just by knowing/guessing its id, via a direct item_tags insert that
-- never goes through src/lib/actions/tags.ts's app-level visibility check --
-- exactly the live RLS check issue #17's Definition of Done calls out
-- ("can't attach another user's private custom tag to their own item").
-- Closing it requires touching this policy's WITH CHECK despite the
-- constraint above; flagged in the issue #17 wrap-up comment.
drop policy "item_tags_insert_own" on public.item_tags;

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
    and exists (
      select 1 from public.tags
      where tags.id = item_tags.tag_id
        and (tags.user_id is null or tags.user_id = auth.uid())
    )
  );
