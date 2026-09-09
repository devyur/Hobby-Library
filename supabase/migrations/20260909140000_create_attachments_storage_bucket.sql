-- Storage: `attachments` bucket for item file attachments (issue #21).
--
-- Design record: _docs/database-schema.md §7 (path-scoped per user) and §3
-- (item_attachments -- "allowed types/size caps are enforced at the
-- application/upload layer and Storage bucket policy, not here"). This
-- bucket does not exist in any prior migration; item_attachments itself was
-- created back in 20260908140000_create_item_relations_tables.sql, but
-- nothing ever provisioned the Storage bucket its storage_path column
-- points into.
--
-- Unlike `covers` (20260908170000_create_covers_storage_bucket.sql), which
-- needed a second migration
-- (20260909130000_set_covers_bucket_limits.sql) to add
-- file_size_limit/allowed_mime_types after the fact, this bucket sets both
-- at creation -- 2 MB (2097152 bytes) matches MAX_ATTACHMENT_SIZE_BYTES
-- (src/lib/validation/attachments.ts), and the three MIME types are the
-- canonical ones the app itself assigns from a validated .txt/.md/.pdf
-- extension (never the browser-supplied File.type), so nothing else needs
-- to be allowed here.
--
-- Private (public = false), same reasoning as `covers`: callers resolve a
-- signed URL per request (src/lib/queries/items.ts's getItemDetail, and
-- uploadAttachmentAction/lib/actions/attachments.ts) rather than
-- getPublicUrl().
--
-- Policies mirror `covers`' per-user path-scoped shape exactly, checked via
-- storage.foldername(name)[1] = auth.uid()::text -- the storage path is
-- {user_id}/{item_id}/{attachment_id} (database-schema.md's per-item cover
-- path was {user_id}/{item_id}/cover; this bucket's per-attachment path
-- adds one more id-keyed segment instead of a fixed filename, since an item
-- can have multiple attachments). These storage policies are who-can-write
-- (path ownership only); uploadAttachmentAction/removeAttachmentAction never
-- rely on them alone -- they re-check the referencing item's ownership via
-- item_attachments' own RLS (items.user_id = auth.uid()) first.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  2097152,
  array['text/plain', 'text/markdown', 'application/pdf']
)
on conflict (id) do nothing;

create policy "attachments_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "attachments_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "attachments_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "attachments_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
