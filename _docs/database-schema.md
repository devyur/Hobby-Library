# Database Schema — Design Decisions (Draft V1)

Target: Postgres via Supabase. This document captures the schema decisions made before implementation. No SQL/code yet — this is the design record.

---

## 1. Ownership model

**Decision: standard per-user ownership with Row-Level Security (RLS).**

Every user who registers gets their own private library. All user-owned rows carry a `user_id` referencing `auth.users`, and RLS policies restrict reads/writes to `user_id = auth.uid()`.

Why: the plan's own roadmap (public profile, individual item/list sharing, per-field privacy controls) only makes sense if each account has its own isolated library that can later be selectively exposed. Building this in from the start avoids an ownership-model migration later. It doesn't prevent this being "just you" today — it's just the model that scales cleanly.

---

## 2. Fixed vs. extensible classification

**Decision: `status` (Planned/Ongoing/Completed/Dropped) and `priority` (Low/Medium/High) are Postgres native `enum` types — fixed, not user-extensible.**

**Decision: `categories` is a lookup table, not an enum** — seeded with exactly Games/Books/Audio/Video for V1, but adding a 5th top-level category later (e.g. "Board Games") becomes a plain data insert instead of a schema migration. Not user-editable through the app in V1 (top-level categories stay admin/seed-managed, unlike subtypes/tags which the plan explicitly makes user-extensible); the table form exists purely so that changing the set later is cheap.

**Decision: `subtypes` and `tags` are tables — predefined (system) rows plus user-created custom rows.**

Why: the plan explicitly calls status/priority a closed structural set (four lifecycle states, three priority levels) — enums are cheap and type-safe there. Categories are *treated* as closed for V1 but given a lookup table anyway since the cost is low and it removes the one-time enum-migration risk. Subtypes and tags are explicitly "predefined + custom / extensible," so they must be tables.

### `categories`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| slug | text, not null, unique | e.g. `games`, `books`, `audio`, `video` — stable machine key |
| name | text, not null | display label |
| sort_order | int, default 0 | controls tab ordering |
| created_at | timestamptz | |

Seeded with exactly four rows for V1.

**Forward note:** the user anticipates wanting categories that don't fit Games/Books/Audio/Video well (e.g. "Journeys", "Sport"). Since `categories` is already a table, adding one later is just a data insert plus its own `subtypes` rows — no schema change. The one implication this places on the frontend: the main navigation must render tabs **dynamically from the `categories` table**, not as four hardcoded routes/components, so a new category doesn't require a code change to appear in the nav. Flagging now so this constraint carries into the frontend architecture decisions.

---

## 3. Core tables

### `subtypes`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| category_id | FK categories.id, not null | which top-level category this subtype belongs to |
| name | text, not null | e.g. "RPG", "Educational" |
| user_id | uuid, nullable, FK auth.users | NULL = global predefined subtype (seeded, visible to everyone); set = a user's custom subtype |
| created_at | timestamptz | |

Unique per (category_id, lower(name), user_id) to prevent duplicates within the same scope.

### `tags`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| name | text, not null | |
| user_id | uuid, nullable, FK auth.users | NULL = global predefined tag; set = custom tag |
| created_at | timestamptz | |

Tags are global (not scoped to a category) — matches the plan's example of a Book carrying `programming`/`Python`/`career` tags.

Unique per (lower(name), user_id), NULLS NOT DISTINCT — mirrors `subtypes`' uniqueness guard, added by issue #17's migration alongside `tags`' first INSERT policy (a signed-in user may only create a tag with `user_id` equal to their own id). This index does not stop a custom tag from duplicating a predefined tag's name, since they have different `user_id` values; that cross-scope duplicate is prevented only by the app-level lookup-before-create check in `src/lib/actions/tags.ts`.

### `items`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| user_id | uuid, not null, FK auth.users | owner |
| title | text, not null | |
| category_id | FK categories.id, not null | |
| subtype_id | uuid, not null, FK subtypes.id | must belong to the same `category_id` — enforced by a trigger, since Postgres FKs can't cross-check a second column directly |
| status | item_status enum, not null, default 'planned' | |
| priority | priority_level enum, nullable | kept even if status later changes away from Planned, so a value isn't lost if demoted back |
| rating | smallint, nullable, check 1–10 | |
| notes | text, nullable | |
| review | text, nullable | |
| created_at | timestamptz, default now() | "date added" |
| updated_at | timestamptz | maintained by trigger |
| completed_at | timestamptz, nullable | set manually, never inferred automatically (per plan §4) |
| deleted_at | timestamptz, nullable | soft delete — non-null means "in Trash" |
| recommendation_dismissed_at | timestamptz, nullable, default null | non-null means this item is dismissed from Dashboard Recommendations (issue #44) — excluded from every recommendation query regardless of status/deleted_at; keyed by this row's own id, so a later-created item with the same title/category is never treated as already dismissed |

### `item_tags` (junction)
| column | type |
|---|---|
| item_id | FK items.id, cascade delete |
| tag_id | FK tags.id, cascade delete |

Primary key `(item_id, tag_id)`.

`tag_id`'s cascade was added by issue #17's follow-up migration (`20260909110000_cascade_item_tags_tag_delete.sql`) — it originally had no `ON DELETE` action, which was inert while every `tags` row was predefined (never deleted by any real path). #17 adds user-owned `tags` rows, and with them the first realistic way a `tags` row gets deleted: cascading from the owning user's `auth.users` row on account deletion. Without this fix, that cascade failed outright (a foreign key violation) whenever the deleted user still had one of their own custom tags attached to any item.

### `item_images`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| item_id | FK items.id, cascade | |
| storage_path | text, not null | path in Supabase Storage |
| is_cover | boolean, default false | |
| sort_order | int, default 0 | |
| created_at | timestamptz | |
| updated_at | timestamptz | added by [#38](https://github.com/devyur/Hobby-Library/issues/38); maintained by an `item_images_set_updated_at` trigger, same shape as `items`/`lists`/`user_preferences`. Source of the `covers` public URL's `?v=` cache-busting param (see §7) — `uploadCoverAction`'s replace path now performs a real `UPDATE` on this row (not a no-op) so it advances on every cover replace, not only the first upload. |

A partial unique index enforces at most one `is_cover = true` row per item. V1 only ever inserts one image (the cover), but the table already supports many — satisfies plan §9's "design for multiple images later" without a future schema change.

### `item_links`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| item_id | FK items.id, cascade | |
| url | text, not null | |
| label | text, nullable | e.g. "IMDb", "Store page" |
| created_at | timestamptz | |

### `item_attachments`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| item_id | FK items.id, cascade | |
| storage_path | text, not null | |
| filename | text, not null | |
| mime_type | text, not null | |
| size_bytes | bigint, not null | |
| created_at | timestamptz | |

Allowed types/size caps enforced at the application/upload layer plus Supabase Storage bucket policy, not in the DB schema itself.

### `lists`
| column | type |
|---|---|
| id | uuid, pk |
| user_id | FK auth.users, not null |
| name | text, not null |
| created_at | timestamptz |
| updated_at | timestamptz |

### `list_items`
| column | type |
|---|---|
| list_id | FK lists.id, cascade |
| item_id | FK items.id, cascade |
| sort_order | int, default 0 |
| added_at | timestamptz, default now() |

`sort_order` drives manual drag-reordering within a list ([#42](https://github.com/devyur/Hobby-Library/issues/42)) — `getListDetail` orders members by `sort_order asc, added_at asc`, replacing the original "most recently added first" ordering. A new add no longer leaves `sort_order` at its column default; `addItemToListAction` computes current-max-in-list + 1 so it appends to the end instead of colliding at 0. Reordering is a single `upsert()` of every row's new `sort_order` per drop, gated by the existing `list_items` update policy (no new RLS needed — see §4).

Primary key `(list_id, item_id)`.

---

### `user_preferences`
| column | type | notes |
|---|---|---|
| user_id | uuid, pk, FK auth.users | one row per user |
| theme | text, nullable | `'light'` / `'dark'` / `null` (null = follow system preference) |
| last_screen | text, nullable | path/route of the last screen visited, for plan §15's "remember last screen" |
| default_sort | text, nullable | `'recently_added'` / `'priority'` / `'status'` / `'rating'` / `'title'` / `null` (null = `'recently_added'`), last-chosen sort dimension, for plan §13 |
| default_sort_direction | text, nullable | `'asc'` / `'desc'` / `null` (null = the selected `default_sort` dimension's own default direction), last-chosen direction, for plan §13 |
| list_view_mode | text, nullable | `'list'` / `'card'`, last-chosen library display mode |
| updated_at | timestamptz | |

Added per the UI style guide decision to persist theme choice server-side (so it syncs across devices) rather than in `localStorage` — and since that requires a per-user preferences row anyway, the already-decided "remember last screen" and "remember sort" requirements are folded into the same table rather than each inventing its own storage.

`theme`, `list_view_mode`, `default_sort`, and `default_sort_direction` each carry a check constraint restricting them to the enumerated values above (or `null`) — `theme in ('light', 'dark')`, `list_view_mode in ('list', 'card')`, `default_sort in ('recently_added', 'priority', 'status', 'rating', 'title')`, `default_sort_direction in ('asc', 'desc')`. `theme`/`list_view_mode`'s constraints were added in the `user_preferences` migration, see [#8](https://github.com/devyur/Hobby-Library/issues/8); `default_sort`'s was added later, once [#24](https://github.com/devyur/Hobby-Library/issues/24) defined its original three-value set, via `supabase/migrations/20260909160000_add_default_sort_check_constraint.sql`; both were extended/added by [#39](https://github.com/devyur/Hobby-Library/issues/39) (direction toggle + the `rating`/`title` dimensions folded in from #40) via `supabase/migrations/20260910160000_add_sort_direction_and_dimensions.sql`.

`default_sort_direction` is a single column applied to whichever dimension `default_sort` currently names — not a doubled enum on `default_sort` itself (no `priority_asc`/`priority_desc`-style values) and not five separate per-dimension direction columns. What `'asc'`/`'desc'` *mean* is dimension-specific:

- `recently_added`, `rating`, and `title` have a real ascending/descending scale: `recently_added` orders by `created_at` (`'desc'`/default = newest first, `'asc'` = oldest first); `rating` orders by the `rating` column (`'desc'`/default = highest first, `'asc'` = lowest first) with `NULLS LAST` in *both* directions, so a rating-less item never sorts first or interleaves with rated ones (same NULL-last precedent as #23's rating filter); `title` orders case-insensitively (`'asc'`/default = A→Z, `'desc'` = Z→A) via the `item_title_sort_key` computed field (`lower(title)`), since the raw column's collation isn't guaranteed to interleave by letter across case.
- `priority` and `status` have **no** inherent ascending/descending scale — "direction" for these is defined purely as reversing the fixed bucket order end-to-end, not a value judgement about which bucket is "more." `priority` orders `High → Medium → Low → (no priority set)` by default (`'desc'`) or the same three buckets reversed, `Low → Medium → High → (no priority set)`, when toggled (`'asc'`) — "no priority set" stays pinned last in both directions, never reversed into first place. `status` orders `Ongoing → Planned → Completed → Dropped` by default (`'desc'`) or fully reversed, `Dropped → Completed → Planned → Ongoing`, when toggled (`'asc'`).

All five dimensions break ties (equal bucket/rating/title) by `created_at` descending — fixed, never itself reversed by `default_sort_direction`. See plan.md §13 for the full rationale — the ordering itself is expressed in Postgres via PostgREST computed-field functions rather than fetched unsorted and reordered in application code: `item_priority_rank`/`item_status_rank` (added by #24's migration), plus `item_priority_rank_reverse` (priority's reversed-direction rank, "no priority set" independently pinned to last in this function too) and `item_title_sort_key` (`lower(title)`), both added by #39's migration. `status`'s reversed direction needs no separate function — it just flips `item_status_rank`'s own `ascending` flag, since (unlike priority) there's no "unset" bucket to protect from being reordered out of last place.

---

## 4. Row-Level Security

All user-owned tables get RLS policies scoping reads/writes to `auth.uid()` (directly via `user_id`, or via a join to `items.user_id`/`lists.user_id` for child tables). `categories` rows and global predefined `subtypes`/`tags` rows (`user_id IS NULL`) are readable by all authenticated users, writable only via migration/seed (not through the app) — except `tags` and `subtypes`, which since issues #17 and #18 respectively also have an app-facing create path (a user creating their own custom tag or subtype): each table's SELECT policy scopes to `user_id IS NULL OR user_id = auth.uid()` (a custom row is never visible to another user) and its INSERT policy's `WITH CHECK (user_id = auth.uid())` means a user can only ever create a row owned by themselves. Before #18, `subtypes_select_authenticated` was fully open (`USING (true)`) since only predefined rows existed; it was tightened in the same migration that added the INSERT policy.

`list_items`' `insert`/`update` policies additionally require the referenced `item_id` to belong to the same user (an `exists` check against `items.user_id = auth.uid()`, alongside the usual `exists` check that the parent `lists` row belongs to the user). Without this, a user could add another user's item into their own list purely by knowing its id, since owning the list row alone isn't enough to prove ownership of the item being linked into it.

Similarly, `item_tags_insert_own` (originally #5, revised by #17) additionally requires the referenced `tag_id` to be visible to the caller (`tags.user_id IS NULL OR tags.user_id = auth.uid()`), alongside its original `exists` check that the parent item belongs to the user. Without this, a user could attach another user's private custom tag to their own item purely by knowing its id, since owning the item alone isn't enough to prove the tag being attached is actually visible to them.

For the same reason, issue #18 extended the `items_check_subtype_category` trigger (§3 `items`) with an ownership check alongside its original category-match check: a `subtype_id` must now also be visible to the row's `user_id` (`subtypes.user_id IS NULL OR subtypes.user_id = auth.uid()`), not just belong to the right category. Without this, a crafted `insert`/`update` could set an item's `subtype_id` to another user's private custom subtype purely by knowing its id.

**`service_role` table grants (issue #33).** Every `grant` statement in every migration through #24 grants only to `authenticated` — with varying scope per table (`select` only on `categories`; `select, insert` on the other two lookup tables, `subtypes`/`tags`; full CRUD on the rest) — never to `anon` or to `service_role`. This is a real, project-wide gap, not a design choice: it was first surfaced live during #10's QA (a `service_role`-authenticated PostgREST request against `user_preferences`, then re-tested against `categories`/`items`, all returned `permission denied`), because Postgres's table-level `grant` is a separate access gate from RLS — `service_role` bypassing RLS (Supabase's own convention once a role holds `BYPASSRLS`) does not, by itself, grant it permission to touch a table at all. #33 fixes this by granting `service_role` `select, insert, update, delete` uniformly across all 11 app tables (`categories`, `subtypes`, `tags`, `items`, `item_tags`, `item_images`, `item_links`, `item_attachments`, `lists`, `list_items`, `user_preferences`) — including the three lookup tables, where `authenticated` itself gets less than full CRUD. The grant is deliberately uniform rather than mirroring each table's narrower `authenticated` grant: since `service_role` already bypasses every RLS policy once it holds any grant, restricting it to a subset of verbs is not a security boundary (nothing stops the same key from being re-granted the missing verb later) — it would only risk a future admin/export/seed script hitting an avoidable `permission denied` and needing its own follow-up migration. This is an admin-trust decision (the service key is never exposed to the client, same trust level as the Supabase dashboard's own SQL editor), not a narrowing of what's actually protected.

**Storage needs no equivalent grant.** Unlike Postgres tables reached via PostgREST, Storage requests (`covers`/`attachments`, §7) go through the separate Storage API server, which authorizes a `service_role`-keyed request itself rather than deferring to `storage.objects`' RLS policies or a table-level `grant` — confirmed in-repo: `e2e/trash.spec.ts`'s Permanent Delete test calls `admin.storage.from("covers").list(...)`/`.remove(...)` (and the same for `attachments`) with the service-role client, and it already passes, with no `service_role` storage policy defined anywhere in `supabase/migrations/`. So #33's fix is Postgres-table-only; the Storage buckets needed no migration change, only this note so the gap isn't assumed to extend there.

---

## 5. Search & filtering (V1)

Per plan §11, V1 needs partial-word matching, not a query language. Approach: `pg_trgm` trigram GIN indexes on `items.title`, `items.notes`, `items.review`, enabling fast `ILIKE '%term%'` search directly on those three `items` columns.

**Tags** (issue #22): plan §11 lists tags as a searched field, but `tags` is a separate table reached through the `item_tags` junction, not a column on `items` — it can't share the three indexes above. A tag-name match instead needs an `EXISTS` join, e.g. `EXISTS (SELECT 1 FROM item_tags JOIN tags ON tags.id = item_tags.tag_id WHERE item_tags.item_id = items.id AND tags.name ILIKE '%term%')`, OR'd alongside the title/notes/review `ILIKE`s. `tags.name` gets its own `pg_trgm` trigram GIN index for the same reason as the three `items` columns — without it, that `EXISTS` subquery falls back to a sequential scan over `tags` as the table grows with custom tags.

The `pg_trgm` extension and all four trigram GIN indexes were added together in #22's migration — nothing filed before #22 had needed them.

Combined filters (category + subtype + status + rating + tags) are a separate concern from this free-text search box — exact-match filtering, not partial-word text search — and are plain `WHERE`/`JOIN` queries needing no extra schema; see issue #23. Full-text search (`tsvector`) is a possible future upgrade, not needed for V1.

---

## 6. Dashboard statistics

No dedicated tables. All stats (totals, per-status counts, average rating, completion rate, rating distribution, category breakdown) are aggregate queries over `items`. A Postgres view could be added later purely as a convenience, not a requirement.

---

## 7. Storage buckets (Supabase Storage)

- `covers` — item cover images, path-scoped per user. Since #19, a single cover lives at the fixed extension-less path `{user_id}/{item_id}/cover`, uploaded with `upsert: true` so replacing a cover overwrites in place (no orphaned object, no race against the partial unique index on `item_images`). `file_size_limit` (5MB) and `allowed_mime_types` (`image/jpeg`, `image/png`, `image/webp`) were added to the bucket itself in a later #19 migration as storage-layer defense-in-depth alongside the app-level check. Since #35, removing a cover deletes both this object and its `item_images` row (never just one; a storage-delete failure leaves the row intact). Since #37, whatever a user uploads is resized client-side to ~800px on its long edge and re-encoded to WebP before it ever reaches this bucket — the 5MB cap is a safety net for that pipeline, not the normal-case ceiling (a resized cover typically lands in the tens of KB). **Public bucket since #38** (`public = true`; a leaked cover URL only ever exposes non-sensitive cover art, never account data — an accepted tradeoff): `src/lib/queries/items.ts` resolves cover URLs via `getPublicUrl()` instead of a per-request signed URL, appending `?v={item_images.updated_at as epoch ms}` so a long browser cache lifetime is safe — the query string changes whenever the underlying object is actually replaced, so a cached copy is never served stale. The per-user `insert`/`update`/`select`/`delete` storage policies (added during #12) are unchanged by #38: `public = true` only bypasses RLS for the anonymous `/object/public/...` GET endpoint, not the authenticated `list()`/`download()`/etc API those policies still gate.
- `attachments` — uploaded reference files, same per-user path-scoping, but per-file (not fixed-path) since an item can have many: `{user_id}/{item_id}/{attachment_id}`. Created by #21 with its bucket-level `file_size_limit` (2MB) and `allowed_mime_types` (`text/plain`, `text/markdown`, `application/pdf`) set at creation time, alongside app-level checks and a 10-attachments-per-item cap enforced in the Server Action.
- Storage objects in either bucket are not linked to Postgres FKs, so Permanent Delete (§9) explicitly clears both buckets' `{user_id}/{item_id}/...` paths itself before deleting the row — this doesn't happen automatically from the cascade alone.

---

## 8. Export / Import

Export walks `items` joined with `item_tags→tags`, `item_links`, `item_attachments` (metadata only, not file bytes), `item_images` (metadata), and `lists`/`list_items`, serialized to JSON (CSV optional/secondary per plan §23). Import reverses this, matching or creating `tags`/`subtypes` by name when not already present for the user.

---

## 9. Trash / soft delete

Deleting an item sets `deleted_at = now()` rather than removing the row. Trash view = `WHERE deleted_at IS NOT NULL`. Restore = set back to `NULL`. Permanent delete (#25) first clears the item's Storage objects in both the `covers` and `attachments` buckets (`{user_id}/{item_id}/...`) — a failure there blocks the row delete entirely, so an item never loses its files without also losing its row, or vice versa — then does the actual `DELETE`, which cascades to the item's tags/images/links/attachments/list memberships.

---

## Status

All decisions above are finalized. Next planning steps: exact subtype lists per category, exact predefined tags, then project folder/code architecture and V1 milestone breakdown.
