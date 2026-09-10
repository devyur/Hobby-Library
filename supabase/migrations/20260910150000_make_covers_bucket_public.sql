-- Storage: make the `covers` bucket public, and add a real version marker
-- for the cover-URL cache-busting this enables.
--
-- Design record: _docs/database-schema.md §7. Issue #38 (re-groomed after
-- #35/#37): a signed URL's token changes on every call, so the browser
-- never recognizes "I already have this picture" and re-fetches every
-- cover on every page load. `public = true` lets src/lib/queries/items.ts
-- switch to getPublicUrl() (a stable URL, safe to cache long-lived)
-- instead of createSignedUrl().
--
-- Bucket-visibility change ONLY: `public = true` exempts the anonymous
-- Storage `/object/public/...` GET endpoint from RLS. It does NOT exempt
-- the authenticated object-management API (`list()`/`download()`/etc, used
-- directly by e2e/cover-upload.spec.ts and e2e/cover-remove.spec.ts) from
-- `storage.objects` RLS -- so `covers_select_own` (20260908170000) and the
-- three write policies (`covers_insert_own`/`covers_update_own`/
-- `covers_delete_own`) are all left exactly as they are: not dropped, not
-- altered. A leaked cover-image URL only ever exposes non-sensitive cover
-- art, never account data -- accepted tradeoff, decided in #38.
--
-- The `attachments` bucket (20260909140000) is untouched: reference files
-- don't carry the same low-stakes-if-exposed framing, so it stays private
-- and keeps serving via createSignedUrl().

update storage.buckets
set public = true
where id = 'covers';

-- ---------------------------------------------------------------------------
-- item_images.updated_at: the version-marker source for the public cover
-- URL's `?v=` cache-busting param.
-- ---------------------------------------------------------------------------
-- A public bucket + a long client-side cache lifetime only stays correct if
-- the URL itself changes when the underlying bytes do. `created_at` can't
-- serve that role -- uploadCoverAction's replace path (src/lib/actions/
-- covers.ts) overwrites the storage object in place via `upsert: true`
-- without touching the item_images row at all, so `created_at` never moves
-- on an ordinary replace. This issue also changes that Server Action to
-- perform a real UPDATE on replace (not an insert), so this trigger fires
-- and `updated_at` actually advances every time the cover changes.
--
-- Same before-update-trigger shape as items_set_updated_at
-- (20260908130000_create_items_table.sql), lists_set_updated_at
-- (20260908150000_create_lists_tables.sql), and
-- user_preferences_set_updated_at (20260908160000_create_user_preferences_table.sql).

alter table public.item_images
  add column updated_at timestamptz not null default now();

create function public.item_images_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger item_images_set_updated_at
  before update on public.item_images
  for each row
  execute function public.item_images_set_updated_at();
