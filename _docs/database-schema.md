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

### `item_tags` (junction)
| column | type |
|---|---|
| item_id | FK items.id, cascade delete |
| tag_id | FK tags.id |

Primary key `(item_id, tag_id)`.

### `item_images`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| item_id | FK items.id, cascade | |
| storage_path | text, not null | path in Supabase Storage |
| is_cover | boolean, default false | |
| sort_order | int, default 0 | |
| created_at | timestamptz | |

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

Primary key `(list_id, item_id)`.

---

### `user_preferences`
| column | type | notes |
|---|---|---|
| user_id | uuid, pk, FK auth.users | one row per user |
| theme | text, nullable | `'light'` / `'dark'` / `null` (null = follow system preference) |
| last_screen | text, nullable | path/route of the last screen visited, for plan §15's "remember last screen" |
| default_sort | text, nullable | last-chosen sort option, for plan §13 |
| list_view_mode | text, nullable | `'list'` / `'card'`, last-chosen library display mode |
| updated_at | timestamptz | |

Added per the UI style guide decision to persist theme choice server-side (so it syncs across devices) rather than in `localStorage` — and since that requires a per-user preferences row anyway, the already-decided "remember last screen" and "remember sort" requirements are folded into the same table rather than each inventing its own storage.

`theme` and `list_view_mode` each carry a check constraint restricting them to the enumerated values above (or `null`) — `theme in ('light', 'dark')`, `list_view_mode in ('list', 'card')`. `default_sort` is left unconstrained: its value set isn't enumerated anywhere yet (`#24` defines it), so a check constraint would just be guessing. Added in the `user_preferences` migration, see [#8](https://github.com/devyur/Hobby-Library/issues/8).

---

## 4. Row-Level Security

All user-owned tables get RLS policies scoping reads/writes to `auth.uid()` (directly via `user_id`, or via a join to `items.user_id`/`lists.user_id` for child tables). `categories` and global predefined `subtypes`/`tags` rows (`user_id IS NULL`) are readable by all authenticated users, writable only via migration/seed (not through the app).

`list_items`' `insert`/`update` policies additionally require the referenced `item_id` to belong to the same user (an `exists` check against `items.user_id = auth.uid()`, alongside the usual `exists` check that the parent `lists` row belongs to the user). Without this, a user could add another user's item into their own list purely by knowing its id, since owning the list row alone isn't enough to prove ownership of the item being linked into it.

---

## 5. Search & filtering (V1)

Per plan §11, V1 needs partial-word matching, not a query language. Approach: `pg_trgm` trigram GIN indexes on `items.title`, `items.notes`, `items.review`, enabling fast `ILIKE '%term%'` search. Combined filters (category + subtype + status + rating + tags) are plain `WHERE`/`JOIN` queries — no extra schema needed. Full-text search (`tsvector`) is a possible future upgrade, not needed for V1.

---

## 6. Dashboard statistics

No dedicated tables. All stats (totals, per-status counts, average rating, completion rate, rating distribution, category breakdown) are aggregate queries over `items`. A Postgres view could be added later purely as a convenience, not a requirement.

---

## 7. Storage buckets (Supabase Storage)

- `covers` — item cover/gallery images, path-scoped per user (`{user_id}/{item_id}/...`), access controlled via storage policies mirroring the RLS model.
- `attachments` — uploaded reference files, same path-scoping approach.

---

## 8. Export / Import

Export walks `items` joined with `item_tags→tags`, `item_links`, `item_attachments` (metadata only, not file bytes), `item_images` (metadata), and `lists`/`list_items`, serialized to JSON (CSV optional/secondary per plan §23). Import reverses this, matching or creating `tags`/`subtypes` by name when not already present for the user.

---

## 9. Trash / soft delete

Deleting an item sets `deleted_at = now()` rather than removing the row. Trash view = `WHERE deleted_at IS NOT NULL`. Restore = set back to `NULL`. Permanent delete = actual `DELETE`, which cascades to the item's tags/images/links/attachments/list memberships.

---

## Status

All decisions above are finalized. Next planning steps: exact subtype lists per category, exact predefined tags, then project folder/code architecture and V1 milestone breakdown.
