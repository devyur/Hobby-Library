-- Storage: close the one remaining gap in the `covers` bucket from issue
-- #19 (cover image upload) -- the bucket row created by
-- 20260908170000_create_covers_storage_bucket.sql (#12) never set
-- `file_size_limit`/`allowed_mime_types`, leaving both unrestricted at the
-- storage layer. The write policies (`covers_insert_own`/
-- `covers_update_own`/`covers_delete_own`) already scope *who* can write;
-- this scopes *what* they can write.
--
-- Storage-layer defense-in-depth alongside uploadCoverAction's own
-- server-side type/size checks (src/lib/actions/covers.ts) -- never relied
-- on as the only gate, same "app-level plus bucket policy" split
-- database-schema.md already states for item_attachments, applied here to
-- covers. 5 MB matches the cap the Server Action enforces; the three MIME
-- types match what CoverThumbnail.tsx renders via a plain <img>.

update storage.buckets
set
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'covers';
