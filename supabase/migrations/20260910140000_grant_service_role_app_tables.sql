-- Grant service_role access to app tables (issue #33): every prior migration
-- since #3 only ever `grant`s to `authenticated` (with varying scope per
-- table -- e.g. `select` only on `categories`; `select, insert` on the other
-- two lookup tables, `subtypes`/`tags`; full CRUD on the rest), never to
-- `anon` or to `service_role`.
-- Confirmed live: a service_role-authenticated PostgREST request against
-- categories/items/user_preferences all returned `permission denied` --
-- Postgres's table-level `grant` is a separate access gate from RLS, and
-- service_role bypassing RLS does not by itself grant table access.
--
-- Uniform `select, insert, update, delete` across all 11 current app tables,
-- including the three lookup tables where `authenticated` itself has less
-- than full CRUD -- service_role already bypasses RLS once it holds any
-- grant at all, so a narrower per-table grant here buys no real security,
-- only a future avoidable `permission denied` for an admin/export/seed
-- script. Additive only: no change to existing `authenticated` grants or
-- RLS policies.
--
-- Storage buckets (`covers`, `attachments`) need no equivalent change --
-- Storage-API requests are authorized by the Storage server itself, a
-- different code path from `storage.objects`' Postgres RLS/grant model.
-- Already proven: e2e/trash.spec.ts's Permanent Delete test empties both
-- buckets via the service-role client with no storage policy for
-- service_role defined anywhere in supabase/migrations/.
--
-- Design record: _docs/database-schema.md §4.

grant select, insert, update, delete on public.categories to service_role;
grant select, insert, update, delete on public.subtypes to service_role;
grant select, insert, update, delete on public.tags to service_role;
grant select, insert, update, delete on public.items to service_role;
grant select, insert, update, delete on public.item_tags to service_role;
grant select, insert, update, delete on public.item_images to service_role;
grant select, insert, update, delete on public.item_links to service_role;
grant select, insert, update, delete on public.item_attachments to service_role;
grant select, insert, update, delete on public.lists to service_role;
grant select, insert, update, delete on public.list_items to service_role;
grant select, insert, update, delete on public.user_preferences to service_role;
