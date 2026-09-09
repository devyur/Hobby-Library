-- Fix a latent gap issue #17 activates: item_tags.tag_id
-- (20260908140000_create_item_relations_tables.sql) was declared with no
-- ON DELETE action, so deleting a `tags` row failed with a foreign key
-- violation whenever any `item_tags` row still referenced it. That was
-- inert before #17 -- every `tags` row was predefined (`user_id IS NULL`),
-- never deleted by any real path.
--
-- #17 adds the first user-owned `tags` rows (created through the app) and,
-- transitively, the first realistic way a `tags` row gets deleted: a user's
-- own `auth.users` row cascading to their `tags` rows on account deletion
-- (`tags.user_id ... on delete cascade`, from 20260908123222). If that user
-- had attached one of their own custom tags to any item, the still-existing
-- `item_tags` row blocked the cascade -- the user could never be deleted
-- while any of their custom tags were still attached anywhere. Discovered
-- live while cleaning up this issue's own e2e test accounts
-- (`item_tags_tag_id_fkey` violation from `DELETE FROM auth.users`).
--
-- Fix: `item_tags.tag_id` now cascades the same way `item_tags.item_id`
-- already does -- deleting a `tags` row removes any `item_tags` row that
-- referenced it, rather than blocking the delete. This does not change
-- issue #17's own "detach never deletes the tags row" behavior -- that path
-- only ever deletes the `item_tags` row directly, never the `tags` row.
alter table public.item_tags
  drop constraint item_tags_tag_id_fkey;

alter table public.item_tags
  add constraint item_tags_tag_id_fkey
  foreign key (tag_id) references public.tags (id) on delete cascade;
