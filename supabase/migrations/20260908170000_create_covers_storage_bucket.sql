-- Storage: `covers` bucket for item cover/gallery images.
--
-- Design record: _docs/database-schema.md §7 -- "path-scoped per user
-- ({user_id}/{item_id}/...), access controlled via storage policies
-- mirroring the RLS model." No migration created this bucket before now;
-- issue #12 (category library view) needs it to resolve real signed cover
-- URLs, so it's added here per the issue's own "if something forces a
-- schema change anyway, add the migration" constraint.
--
-- Private (public = false): callers must resolve a signed URL per request
-- (see src/lib/queries/items.ts) -- getPublicUrl() would return a URL that
-- 404s against a private bucket, and more importantly would defeat the
-- point of path-scoping if it didn't 404.
--
-- Policies mirror the per-user RLS model used everywhere else in this
-- project, checked against the first path segment via
-- storage.foldername(name) -- e.g. a path of
-- "11111111-.../22222222-.../cover.png" belongs to user 11111111-....

insert into storage.buckets (id, name, public)
values ('covers', 'covers', false)
on conflict (id) do nothing;

create policy "covers_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "covers_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "covers_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "covers_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
