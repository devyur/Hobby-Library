# V1 Backlog

Ordered task list for building the app. Tasks are meant to be done roughly in order (later tasks depend on earlier ones existing), but each task's description is self-contained — it names the source doc for any details it needs, so it can be picked up without reading prior conversation. Design decisions live in `plan.md`, `database-schema.md`, `subtypes-and-tags.md`, `project-structure.md`, `ui-direction.md`, and `ui-style-guide.md`.

---

## 1. Project scaffold with a passing test — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/1)
Goal: Get an empty, deployable Next.js project running with one passing automated test.
Description: Initialize a Next.js (App Router, TypeScript) project in this repo per `project-structure.md`, add Tailwind CSS, and configure a test runner (e.g. Vitest). Write a single trivial test (e.g. rendering a placeholder page) that passes, and confirm the dev server and test command both work locally.

## 2. Supabase project + environment wiring — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/2)
Goal: Stand up a Supabase project and connect it to the app via environment variables.
Description: Create a Supabase project (free tier) and add its URL/anon key to `.env.local`, with placeholders in `.env.example`. Verify the Next.js app can read these env vars; no database tables or queries yet.

## 3. Reference table migrations (categories, subtypes, tags) + seed data — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/3)
Goal: Create the lookup/reference tables and load their V1 seed data.
Description: Write Supabase SQL migrations for `categories`, `subtypes`, and `tags` per `database-schema.md`, plus a seed script inserting the predefined values from `subtypes-and-tags.md`. Confirm the tables and seed rows exist via the Supabase dashboard — no app code needed yet.

## 4. Items table migration, enums, and RLS — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/4)
Goal: Create the core `items` table with its enums and row-level security.
Description: Write the migration for `items` (title, category_id, subtype_id, status, priority, rating, notes, review, timestamps, deleted_at) and the `item_status`/`priority_level` enums, per `database-schema.md`. Add the category/subtype-match trigger and per-user RLS policies, and verify with a manual insert that a user can only see their own rows.

## 5. Item relation table migrations (tags, images, links, attachments) + RLS — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/5)
Goal: Create the tables linking items to tags, images, links, and attachments.
Description: Write migrations for `item_tags`, `item_images`, `item_links`, and `item_attachments` per `database-schema.md`, including the partial unique index limiting one cover image per item. Add RLS policies scoped through the parent item's owner and confirm with manual test inserts.

## 6. Lists table migrations + RLS — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/6)
Goal: Create the custom-lists tables.
Description: Write migrations for `lists` and `list_items` per `database-schema.md`, with per-user RLS on `lists` and ownership-through-list RLS on `list_items`. Confirm a user can create a list and add/remove items via manual testing.

## 7. Typed Supabase client setup — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/7)
Goal: Give the app a type-safe way to talk to Supabase from both server and browser code.
Description: Add `lib/supabase/client.ts` (browser) and `lib/supabase/server.ts` (server component/action client) per `project-structure.md`, and generate `lib/supabase/types.ts` from the live schema via the Supabase CLI. Confirm a simple test query (e.g. counting seeded categories) runs from a server component.

## 8. Design system tokens, theme toggle, and preferences table — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/8)
Goal: Make the light/dark color system, typography, and density rules from `ui-style-guide.md` real and usable before any other screen is built.
Description: Wire the color tokens (both themes), font, and spacing conventions from `ui-style-guide.md` into Tailwind config/CSS variables, and set up the base shadcn/ui primitives on top of them. Add the `user_preferences` table migration (theme, last_screen, default_sort, list_view_mode) with RLS, and implement the theme toggle (defaulting to system preference, persisted to `user_preferences`).

## 9. Authentication — registration, login, logout, password reset, session middleware — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/9)
Goal: Let a user sign up, log in, log out, reset a forgotten password, and stay logged in across requests.
Description: Build the `(auth)` route group (login/register/forgot-password pages) using Supabase Auth's email/password + password-reset flow, styled per `ui-style-guide.md`, and add the session-refresh middleware described in `project-structure.md`. No OAuth providers for V1 — email/password only. An authenticated user should reach a placeholder authenticated page; an unauthenticated one should be redirected to login.

## 10. App shell & dynamic navigation — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/10)
Goal: Build the authenticated app's shared layout with navigation driven by the database.
Description: Build the `(app)/layout.tsx` shell (Dashboard, category tabs, Custom Lists, Trash, Settings) per `plan.md` §15. Category tabs must render dynamically from the `categories` table, not be hardcoded, per the forward-compatibility note in `database-schema.md`. On login, redirect to the user's `user_preferences.last_screen` (falling back to Dashboard for new accounts), and update that field as the user navigates.

## 11. Settings page — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/11)
Goal: Give the nav's "Settings" link somewhere to actually go.
Description: Build a minimal V1 Settings page showing the account's email, a sign-out action, and the theme toggle control (from task 8) in one place. Future privacy/sharing controls (plan §21) will extend this page later — V1 only needs these basics.

## 12. Category library view (list + card) — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/12)
Goal: Show a user's items within one category, in both list and card layouts.
Description: Build the `[category]/page.tsx` route querying `items` for the signed-in user filtered by category, rendered in both the List view and Card view per the density rules in `ui-style-guide.md` §3, with a toggle between them. No filtering/search/sorting yet — just the two display modes over the full set.

## 13. Item detail page (read-only) — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/13)
Goal: Show a single item's full details on its own page.
Description: Build `[category]/[itemId]/page.tsx` displaying all of an item's fields (title, subtype, status, rating, priority, notes, review, tags, cover, links, attachments) per `plan.md` §3, using the spacious/editorial layout called out in `ui-style-guide.md` §3, and visually distinguishing Notes from Review per §7. Display only — editing comes in a later task.

## 14. Full Add form — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/14)
Goal: Let a user create a new item with the complete field set.
Description: Build a form and Server Action covering all fields listed in `plan.md` §17 "Full Add," enforcing the minimum valid item (title + category + subtype + status) per §3. On submit, redirect to the new item's detail page.

## 15. Quick Add flow — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/15)
Goal: Let a user rapidly add an item to their backlog with minimal input.
Description: Build the Quick Add UI and action taking only title + category, auto-setting status to Planned and subtype to the category's "Other" default, per `plan.md` §17. Should be usable in a couple of taps, prioritizing mobile speed.

## 16. Edit item — core fields — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/16)
Goal: Let a user update an existing item's status, rating, priority, notes, and review.
Description: Add edit capability (form + Server Action) on the item detail page for status, rating (1–10, shown as the numeric-badge style from `ui-style-guide.md`), priority, notes, and review, per `plan.md` §4–§7. Include the "suggest marking Completed" prompt behavior from §4 as a nudge, not an automatic change.

## 17. Tag management on an item — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/17)
Goal: Let a user assign existing tags to an item or create new custom tags inline.
Description: Add a tag picker on the item edit view that attaches/detaches `item_tags` rows, and creates a new user-owned `tags` row when the entered tag doesn't already exist, per `plan.md` §8 and `database-schema.md`. Include simple autocomplete against existing predefined + custom tags.

## 18. Custom subtype creation — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/18)
Goal: Let a user add their own subtype within a category, beyond the predefined list.
Description: Add a "create new subtype" option to the subtype picker (Full Add and item edit) that inserts a user-owned row into `subtypes` scoped to the chosen category, per `database-schema.md`. Newly created subtypes should immediately appear as selectable.

## 19. Cover image upload — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/19)
Goal: Let a user upload a single cover image for an item.
Description: Add image upload to the item edit view, storing the file in the Supabase `covers` bucket and inserting an `item_images` row with `is_cover = true`, per `database-schema.md` §7. Display the cover on both the item detail page and the Card view, and confirm the no-cover placeholder treatment from `ui-style-guide.md` §3 looks clean.

## 20. Source links on an item — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/20)
Goal: Let a user add and remove multiple links on an item.
Description: Add a links section to the item edit view backed by `item_links`, supporting an optional label plus URL per `plan.md` §10 (e.g. IMDb, store page). Support adding, removing, and displaying links on the item detail page.

## 21. File attachments on an item — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/21)
Goal: Let a user upload small reference files to an item.
Description: Add attachment upload/list/download to the item edit and detail views, storing files in the Supabase `attachments` bucket and metadata in `item_attachments`, per `plan.md` §10. Restrict to small files of the named types (.txt, .md, PDF); this feature is explicitly negotiable if it proves troublesome.

## 22. Search — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/22)
Goal: Let a user find items by partial-word match across title, tags, notes, and reviews.
Description: Add a search box to the library view wired to the `pg_trgm`-indexed `ILIKE` search described in `database-schema.md` §5, covering the fields listed in `plan.md` §11. Partial-word matching only — no combined query syntax yet.

## 23. Category/subtype/status/tag/rating filtering — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/23)
Goal: Let a user narrow a library view by subtype, status, tags, and rating.
Description: Add filter controls to the category library view that combine via queries against `items`/`item_tags`, supporting combinations like "Games + RPG + Planned + rating ≥ 8" per `plan.md` §11. Filters should be usable together, not just one at a time.

## 24. Sorting + remembered preference — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/24)
Goal: Let a user sort a library view and have that choice persist.
Description: Add sorting by Recently Added (default), Priority, and Status per `plan.md` §13, persisting the user's last-chosen sort to `user_preferences.default_sort` (added in task 8) so it's remembered across sessions and devices.

## 25. Trash — soft delete, restore, permanent delete — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/25)
Goal: Let a user delete an item without losing it immediately.
Description: Wire the delete action to set `deleted_at` instead of removing the row, build the Trash page listing soft-deleted items, and add Restore and Permanent Delete actions per `plan.md` §22 and `database-schema.md` §9. Deleted items must disappear from normal library views.

## 26. Custom lists — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/26)
Goal: Let a user create manual lists and add/remove items from them.
Description: Build the Custom Lists pages (`lists/page.tsx` and `lists/[listId]/page.tsx`) covering create/rename/delete on `lists` and add/remove on `list_items`, per `plan.md` §16. V1 lists are manually managed only — no rule-based/smart lists.

## 27. Dashboard statistics — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/27)
Goal: Show the user meaningful stats about their library.
Description: Build the Dashboard stats section covering the metrics in `plan.md` §14 (total items, per-status counts, average rating, recently added, completion rate, rating distribution, category breakdown), computed via aggregate queries over `items` per `database-schema.md` §6, styled per the dashboard layout sketched in `ui-direction.md`.

## 28. Dashboard recommendations — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/28)
Goal: Give the user a lightweight "what should I consume next" suggestion section.
Description: Build the Dashboard recommendations section per `plan.md` §14, surfacing simple picks such as high-rated Planned items, high-priority Planned items, a random Planned item, and unfinished Ongoing items. Keep the logic simple — no scoring/ML.

## 29. Export — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/29)
Goal: Let a user download their entire library as a file.
Description: Build the `api/export` route producing a JSON export (and optionally CSV) covering everything listed in `plan.md` §23 — items, tags, links, attachment metadata, lists — per the join structure in `database-schema.md` §8.

## 30. Import — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/30)
Goal: Let a user restore/rebuild their library from an exported file.
Description: Build an import flow that accepts a previously exported JSON file and re-creates the corresponding items/tags/links/lists for the signed-in user, matching or creating tags/subtypes by name when they don't already exist, per `plan.md` §23 and `database-schema.md` §8.

## 31. Responsive/mobile polish pass — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/31)
Goal: Make sure every screen built so far works well on a phone, not just desktop.
Description: Do a dedicated pass across all existing pages (library views, item detail/edit, dashboard, lists, trash) tightening layout, touch targets, and navigation for mobile per `plan.md` §20, without introducing a separate mobile-only codebase.

## 32. Production deployment + Supabase keep-alive — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/32)
Goal: Get the app live on the internet on the free-tier stack.
Description: Deploy the app to Vercel connected to the production Supabase project, wire environment variables/secrets, and add the scheduled keep-alive ping (e.g. GitHub Actions cron) discussed in `plan.md`'s tech stack decision to prevent the free Supabase project from pausing.

## 33. Grant service_role access to app tables — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/33)
Goal: Let server-side admin tooling (cron jobs, exports, test/QA scripts) actually read/write app tables.
Description: Discovered during #10's QA — every migration since #3 only grants table access to `authenticated`, never `service_role`, so a service-role-authenticated request currently gets `permission denied` on every app table. Add a migration granting `service_role` the access it needs, and document the reasoning in `database-schema.md` §4.

## 34. Manually set/edit completed_at — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/34)
Goal: Let a user manually set and later edit an item's completion date.
Description: Discovered while grooming #16 — `database-schema.md` §3 designed `completed_at` as "set manually, never inferred automatically," but no V1 task ever scheduled the UI for it, and #16 deliberately left it untouched. Extend #16's edit surface to let a user set/clear `completed_at` (decide date-picker vs. text input, and whether it's only shown when status = Completed) without ever inferring it automatically from a status change.

## 35. Remove/delete an item's cover image — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/35)
Goal: Let a user clear an item's cover image entirely, back to the no-cover placeholder.
Description: Discovered while grooming #19 — cover upload only builds upload/replace, with no "clear the cover" path. Add a remove control that deletes both the storage object and the `item_images` row (never just one), owner-only, per `_docs/database-schema.md` §7.

## 36. ~~Clean up Storage objects on permanent item delete~~ — folded into #25
Folded into #25 during its grooming rather than tracked separately — Permanent Delete's storage cleanup (both `covers` and `attachments` buckets, failure blocks the row delete) shipped as part of #25. [Closed issue](https://github.com/devyur/Hobby-Library/issues/36).

## 37. Client-side resize/compress cover images before upload — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/37)
Goal: Shrink cover images before upload so covers use far less of the free tier's ~1GB Storage / ~5GB-month bandwidth budget.
Description: Discussed with the user while reasoning about free-tier headroom for potentially hundreds of covers per user. Resize client-side (browser Canvas, no new dependency) to a size appropriate for how covers actually render, re-encode at a reasonable quality, and keep #19's existing type/size validation as a safety net rather than a replacement.

## 38. Make covers bucket public with cache-busting for cheap repeat loads — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/38)
Goal: Let cover images cache in the browser across repeat app opens instead of being re-fetched from Supabase every page load.
Description: Discussed with the user alongside #37 while reasoning about free-tier bandwidth. Signed URLs change on every request, so browsers never cache covers today. Switch `covers` to a public bucket (an accepted tradeoff — a leaked link only ever exposes non-sensitive cover art) served via `getPublicUrl()`, plus a version marker in the URL that changes only when a cover is actually replaced, so long browser caching doesn't serve a stale image after a replace.

## 39. Sort direction toggle (ascending/descending) — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/39)
Goal: Let a user flip each sort dimension's direction instead of the one fixed direction #24 shipped.
Description: Discovered while grooming #24 — needs a product decision first (is this wanted, and does `default_sort` need a direction column or paired enum values like `priority_asc`/`priority_desc`) before it's ready for engineering.

## 40. Additional sort options (e.g. Rating, Title A-Z) — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/40)
Goal: Decide whether sort dimensions beyond #24's three (Recently Added, Priority, Status) belong in V1.
Description: Discovered while grooming #24 — Rating and Title A-Z both came up as plausible additions but aren't in `plan.md` §13's V1 list. Needs a product decision (and a `plan.md` update if approved) before implementation.

## 41. Add-to-list shortcut on item detail page — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/41)
Goal: Let a user add an item to a list from the item's own detail page, not just from within the list.
Description: Discovered while grooming #26 — V1 only adds items to a list from `lists/[listId]/page.tsx`'s own picker. Add a shortcut on `[category]/[itemId]/page.tsx` (e.g. alongside Tags/Links/Attachments) that opens a list picker. Needs a product decision on placement/UI before implementation.

## 42. Manual drag-reordering of items within a custom list — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/42)
Goal: Let a user manually reorder items within a custom list.
Description: Discovered while grooming #26 — `list_items.sort_order` exists in the schema but #26 ships V1 ordering as plain insertion order only, leaving `sort_order` written at a constant default. Add drag-and-drop (or another reordering control) that persists a per-item `sort_order`, then switch the list's display to sort by it.

## 43. Dashboard consumption/library trends — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/43)
Goal: Decide whether a consumption/library trends view (e.g. completions or additions over time) belongs in V1's Dashboard.
Description: Discovered while grooming #27 — `plan.md` §14 lists this alongside #27's seven well-specified metrics but gives no timeframe, chart type, or definition, so #27 deliberately excluded it as too undefined to groom. Needs a product decision on scope before it can be groomed for engineering; may not be worth building for V1 given typical low weekly item-count.

## 44. Smarter/interactive dashboard recommendations (dismiss, refresh, weighted ranking) — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/44) — done
Goal: Let a user dismiss/refresh individual recommendations, or replace #28's four independent picks with a weighted ranking.
Description: Shipped: weighted "Recommended Planned" ranking, Shuffle, and per-item dismiss via `items.recommendation_dismissed_at` (`lib/actions/recommendations.ts`). Its migration was committed but not applied to the live DB until [#55](https://github.com/devyur/Hobby-Library/issues/55) caught and fixed the gap.

## 45. CSV export (secondary format) — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/45) — done
Goal: Let a user download their library as CSV in addition to JSON.
Description: Shipped as a pure `buildExportCsv()` function (`src/lib/queries/exportCsv.ts`) derived from the same `ExportData` shape JSON export already assembles, RFC 4180 escaping/UTF-8 BOM/CRLF rows, export-only (no import round-trip). `GET /api/export?format=csv`; JSON path unchanged.

## 46. Fix created_at hydration mismatch near local-midnight boundary — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/46) — done
Goal: Stop a real React hydration-mismatch error on the item detail page's "Added:" row when the server and viewer disagree on the calendar date near local midnight.
Description: Fixed via a new `LocalDate` client component (`src/components/ui/LocalDate.tsx`) that renders a UTC-forced placeholder for SSR/first paint, then swaps in the real local-time string post-mount via `useSyncExternalStore` (matching `ThemeToggle.tsx`'s existing pattern). Used by `ItemEditForm.tsx`'s "Added:" row and `TrashList.tsx`'s "Deleted" row; `LibraryStats.tsx` needed no change (pure Server Component, structurally immune).

## 47. Upload cover image from clipboard paste — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/47) — done
Goal: Let a user paste an image from their clipboard as an item's cover, not just pick a file.
Description: Shipped by extracting `CoverUploadControl.tsx`'s file-input pipeline into a shared `submitFile(File)`, reused by both the existing file input and a new `paste` handler (control is now a focusable paste zone with a visible hint). Non-image paste is a silent no-op; validation/resize/server action all unchanged.

## 48. Always-interactive Notes/Review editing, with empty-state CTAs — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/48) — done
Goal: Let a user add/edit Notes and Review independently of the item's main Edit mode, with an inviting empty state instead of nothing when both are blank.
Description: Shipped: `NotesReview.tsx` is now two always-interactive editors (mirroring `ItemTagsEditor.tsx`), each with its own Server Action (`updateNotesAction`/`updateReviewAction`) and CTA→inline-textarea empty state; `updateItemAction` no longer touches notes/review at all. The #16 nudge split: rating's stays block-before-save (three-button banner) in the main form, Review's nudge is new — check-after-save inside `updateReviewAction` (computed against fresh DB state), two-button banner, via a new `markItemCompletedAction`.

## 49. Move Trash link from main nav into Settings — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/49) — done
Goal: Relocate the Trash entry point out of the main nav into Settings, since it's used infrequently.
Description: Shipped: removed from `buildNavItems()` (`navItems.ts`), added as a new section on the Settings page. `/trash` itself and `last_screen` redirect behavior unchanged.

## 50. Per-category Dashboard statistics view — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/50) — done
Goal: Let a user drill into one category from the Dashboard to see library/stats/recently-added scoped to just that category, while trends/recommendations/continue stay account-wide.
Description: Shipped as a new route `/dashboard/[category]`, reusing `LibraryStats.tsx` (its own "Your library"/"Library statistics"/"Recently added" sections) via a new `categoryId`-filtered `getCategoryDashboardStats()`, sharing aggregation logic with the main Dashboard's query via an extracted `buildDashboardStats()` helper. CompletionTrends/RecommendationsSection are never rendered on this route. Entry point: the main Dashboard's Category breakdown tile rows now link here.

## 51. Fix production navigation latency: pin Vercel function region to Frankfurt (fra1) — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/51) — done
Goal: Diagnose and fix why navigating the live production app took 3-5s per click.
Description: Investigated live (real TTFB profiling on production, disposable test account) before fixing, per its original investigation-first scoping. Findings: cold starts ruled out (no cold/warm gap); region mismatch confirmed as primary cause (Vercel functions ran in `iad1`, Supabase is `eu-central-1`); `getItemDetail` already uses one joined query + `Promise.all`, not sequential awaits. Fix: `vercel.json`'s `regions: ["fra1"]`, verified live via the `X-Vercel-Id` response header. TTFB dropped from ~600-1900ms to ~500-1000ms — a real but partial improvement (residual latency tracked by #58, including the discovery that Middleware runs on Vercel's Edge Runtime and isn't pinned by `regions`).

## 55. Live DB missing recommendation_dismissed_at column (#44 migration never applied) — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/55) — done
Goal: Fix the Dashboard's dismiss/shuffle Recommendations feature (#44), broken in production.
Description: Found by QA verifying #45 — #44's migration (`20260911100000_add_items_recommendation_dismissed_at.sql`) was committed to the repo in a separate session but never pushed to the live Supabase database. Fixed by applying it directly via `supabase db push`; confirmed the remote DB is up to date with no pending migrations.

## 56. Stale e2e assertion in dashboard-recommendations.spec.ts ("High-rated Planned") — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/56)
Goal: Fix a pre-existing stale e2e test referencing a label #44 renamed before this test was ever updated.
Description: Found by QA verifying #50 while sanity-checking an unrelated flakiness claim — `dashboard-recommendations.spec.ts` asserts `"High-rated Planned"`, a label #44 (`0c905ae`) replaced with "Recommended Planned." Predates #50; not caused by it.

## 57. Category breakdown links don't look clickable — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/57)
Goal: Style the Dashboard's Category breakdown category-name links (#50) so they visually read as links, not plain text.
Description: User didn't notice these were clickable during live testing — no link styling (color/underline/hover). Not groomed yet; discuss alongside the broader in-place-toggle question raised about #50 before implementing.

## 58. Isolate middleware auth-check latency; audit other pages for sequential queries — [GitHub issue](https://github.com/devyur/Hobby-Library/issues/58)
Goal: Two residual investigation items moved out of #51's scope: (1) isolate how much of per-request latency is middleware's blocking `supabase.auth.getUser()` call vs. the page's own query, (2) audit pages beyond `getItemDetail` for unnecessarily sequential (non-parallelized) Supabase queries.
Description: Filed during #51's re-grooming to keep that issue scoped to the region-pin fix. #51's QA pass added concrete evidence for item (1): Middleware runs on Vercel's Edge Runtime, which `vercel.json`'s `regions` field cannot pin — so the auth check likely isn't benefiting from the fra1 fix at all.
