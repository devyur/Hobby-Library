# Hobby Media Library — Project Scope (Draft V1)

## 1. Project goal

A personal cross-media library for tracking things to **watch, read, listen to, and play**, covering the full lifecycle:

- Planned
- Ongoing
- Completed
- Dropped

The tool should make it easy to save interesting media for later, track what has already been consumed, record personal opinions and notes, and discover what to consume next.

The application ideally should work on **PC and mobile** with priority on PC deployment, use a shared account with cloud synchronization, and ideally be deployable for free.

---

## 2. Core media structure

### Top-level categories

The application has four main categories/tabs:

1. **Games**
2. **Books**
3. **Audio**
4. **Video**

Each category has its own library view.

When entering a category, the user can immediately filter by **subtype**.

### Subtypes

Each item has **exactly one subtype**.

Subtypes are:

- predefined per top-level category;
- extensible with custom subtypes.

Initial subtype lists will be decided separately during implementation/planning.

Example:

> Book → Educational  
> Tags → `programming`, `Python`, `career`

Subtype is structural; tags provide flexible additional classification.

---

## 3. Item model

Each media work/title is represented by **one item**.

Adding the same work again does not create another item. If the user rereads/replays/rewatches something, they can simply update the existing item's:

- rating;
- review;
- notes;
- tags;
- status;
- other metadata.

Consumption sessions/history are **out of V1 scope**.

### Required fields

Every item must have:

- Title
- Top-level category
- Subtype
- Status

### Optional fields

- Rating (1–10)
- Notes
- Review
- Tags
- Priority
- Cover image
- Source links
- File attachments
- External metadata
- Dates such as date added / completion date, where useful

---

## 4. Status system

Four statuses:

- **Planned**
- **Ongoing**
- **Completed**
- **Dropped**

Status changes are primarily manual.

The application may show helpful prompts when an action suggests a status change. For example, after adding a substantial review/rating, it may ask whether the user wants to mark the item Completed.

The application should not automatically make assumptions about completion.

---

## 5. Planned-item priority

Planned items have a simple priority:

- Low
- Medium
- High

Priority is useful for deciding what to consume next.

---

## 6. Ratings

A single rating system is used across all media:

**1–10**

This keeps ratings consistent between games, books, audio, and video.

---

## 7. Notes and reviews

Each item has two separate text fields:

### Notes

Personal working notes, thoughts, reminders, quotes, observations, etc.

### Review

The user's considered opinion of the work.

They should be visually distinct on the item page.

---

## 8. Tags

Tags use a **predefined + custom** model.

The application can provide standard tags, while allowing the user to create their own.

Examples:

- sci-fi
- programming
- Python
- history
- career
- dark
- cozy

Tags are separate from category, subtype, status, and priority.

---

## 9. Covers and images

V1 supports an optional **cover image**.

The user can manually upload the image.

The data model should be designed so that multiple images/screenshots could be supported later.

Automatic cover retrieval from metadata sources is a future/optional enhancement.

---

## 10. Sources and attachments

An item can have:

### Links

One or multiple URLs, for example:

- official website
- store page
- IMDb
- Goodreads
- YouTube
- documentation
- other relevant sources

### File attachments

V1 should attempt to support small uploaded files, such as:

- `.txt`
- `.md`
- PDFs
- other small useful reference files

However, this feature is deliberately considered **negotiable**. If file storage/upload makes deployment substantially harder or not deployable for free, the scope can be reduced to links only.

---

## 11. Search and filtering

V1 search should support:

- title/name search
- tags
- rating
- status
- top-level category
- subtype
- notes
- reviews

The initial implementation does not need a sophisticated query language, but can search based on part of word.

Advanced combined filters should be possible later, e.g.:

> Games + RPG + Planned + rating ≥ 8

### Category filtering

Opening a top-level category should immediately expose subtype filters.

---

## 12. Library views

Each category/library supports two display modes:

### List view

Shows compact information such as:

- title
- rating
- status
- subtype
- tags
- priority where relevant

### Card view

A more visual presentation using:

- cover
- title
- rating
- status
- subtype/tags
- other concise information

The user can switch between List and Card views.

---

## 13. Sorting

Default initial sorting:

**Recently added — newest first**

The user can switch to one of five dimensions, each with a direction toggle (added by [#39](https://github.com/devyur/Hobby-Library/issues/39), which also folded in [#40](https://github.com/devyur/Hobby-Library/issues/40)'s two additional dimensions below):

- Recently added — **Newest first** (default) / Oldest first
- Priority — **High → Low** (default) / Low → High
- Status — **Ongoing → Dropped** (default) / Dropped → Ongoing
- Rating — **Highest first** (default) / Lowest first
- Title (A-Z) — **A → Z** (default) / Z → A

The direction toggle's label always states the selected dimension's own two concrete states (as above), never a generic "Ascending/Descending" — that phrasing is meaningless for Priority/Status, which have no inherent greater/lesser scale (see below). Switching *dimension* always resets direction back to the newly-selected one's own default listed above — a direction chosen on one dimension is never carried over to another.

Ordering chosen for each dimension (Priority/Status decided in [#24](https://github.com/devyur/Hobby-Library/issues/24); Rating/Title, and every dimension's reversed direction, decided in #39):

- **Priority** — High → Medium → Low → (no priority set) by default; toggling direction reverses only the High/Medium/Low run to Low → Medium → High — "no priority set" stays pinned last either way, never first or interleaved.
- **Status** — Ongoing → Planned → Completed → Dropped by default; toggling direction reverses the whole bucket order end-to-end, Dropped → Completed → Planned → Ongoing. Status has no inherent "greater/lesser" scale of its own — this is purely a reversal of the fixed bucket order, not a value judgement about which status is "more."
- **Rating** — highest-rated first by default (lowest-rated first when toggled); items with no rating set always sort last, in *both* directions — never first, never interleaved with rated items (same NULL-last precedent as the Rating filter, plan.md §11).
- **Title** — case-insensitive alphabetical, A → Z by default (Z → A when toggled) — e.g. "apple" sorts before "Banana" before "cherry", not grouped by case.

All five dimensions break ties (equal bucket/rating/title) by created_at descending (most recently added first) — the same rule Recently Added uses on its own, and this tie-break is fixed, never itself reversed by the direction toggle.

The application should remember the user's chosen sorting preference (dimension *and* direction) where practical — implemented via `user_preferences.default_sort`/`default_sort_direction` (database-schema.md §3), synced across devices the same way `theme`/`list_view_mode` already are.

---

## 14. Dashboard

The Dashboard should provide both statistics and lightweight recommendations.

### Statistics

At minimum:

- total items
- Planned / Ongoing / Completed / Dropped counts
- average rating
- recently added items
- completion rate
- rating distribution
- media/category breakdown
- consumption/library trends where meaningful

### Recommendations

A small section helping answer:

> "What should I consume next?"

Three groups (merged/made interactive by [#44](https://github.com/devyur/Hobby-Library/issues/44), building on #28's original four static picks):

- **Recommended Planned** — up to 5 Planned items, replacing the original "high-rated" and "high-priority" picks with one combined ranking. Order is a fixed three-key precedence (not a blended numeric score — see below): priority bucket first (High → Medium → Low → no-priority-set, same bucket order as the Priority sort dimension, §13), then rating descending within a tied bucket (unrated items sort last, never interleaved — same NULL-last rule as the Rating sort dimension), then `created_at` descending as the final tie-break.
- **Random pick** — one random Planned item, unchanged selection logic from #28. Carries a **Shuffle** control (shown whenever the group itself renders) that re-rolls this one pick in place, client-side/server-action, no full page reload and no guarantee of a different item than before.
- **Continue** — up to 5 unfinished/Ongoing items by `created_at` descending, unchanged from #28.

**Dismiss**: every card in every group has a dismiss control. Dismissing removes the card from view immediately (no reload) and persists server-side via `items.recommendation_dismissed_at` (database-schema.md §3) — a dismissed item never resurfaces in any group, on any device, regardless of later status changes, until explicitly un-dismissed. Right after dismissing, an immediate inline "Undo" is offered; once that window is gone, reversing the dismiss needs a future un-dismiss screen ([#54](https://github.com/devyur/Hobby-Library/issues/54)) — out of scope here. Dismissing the Random pick's item auto-replaces it with a new random pick (the same mechanism Shuffle uses); dismissing from Recommended Planned/Continue does not backfill a replacement until the next reload. If a dismiss leaves every group empty, the Dashboard shows a message distinct from the "add a few items to your library to see suggestions here" zero-state, since that wording is misleading once the account has items but every current pick has been dismissed.

A blended/weighted numeric score combining rating + priority + recency into one tunable value (rather than the fixed three-key precedence above) is intentionally deferred — see [#53](https://github.com/devyur/Hobby-Library/issues/53).

Recommendations stay account-wide/combined across categories (unrelated to #50's per-category Dashboard statistics, which only covers the Statistics panels).

---

## 15. Navigation

Main navigation should expose:

- Dashboard
- Games
- Books
- Audio
- Video
- Custom Lists
- Trash
- Settings/Profile

The application should remember the last screen used.

For a new account, Dashboard is the default starting screen.

---

## 16. Custom lists

The user has one main library but can create custom lists.

Examples:

- Play next
- Read soon
- Best games
- Learning resources
- Recommendations

### V1

Simple manually managed lists:

- add item
- remove item
- rename/delete list
- manually drag-reorder items within a list ([#42](https://github.com/devyur/Hobby-Library/issues/42))
- add/remove an item from any of its lists directly from the item detail page, not only the list's own page ([#41](https://github.com/devyur/Hobby-Library/issues/41))

### Future

Smart/automatic lists based on rules, e.g.:

> Planned + rating ≥ 8 + Games

---

## 17. Adding items

Two ways to add an item:

### Quick Add

Designed for quickly dumping something into the backlog, especially on mobile.

Minimum:

- Title
- Category

Quick Add automatically creates:

- Status = Planned
- Subtype = appropriate/default value that can be corrected afterward

The user can fill in more information later.

### Full Add

Allows complete entry of:

- title
- category
- subtype
- status
- rating
- priority
- tags
- notes
- review
- cover
- links
- attachments

The minimum valid item for the full form is:

**Title + category + subtype + status**

---

## 18. Metadata lookup

Metadata lookup is an **optional enhancement**, not a dependency of the core application.

Potential future behavior:

- enter title or paste a link;
- select a trusted metadata source;
- retrieve information such as:
  - cover
  - description
  - author/developer/director
  - release/publication date
  - other relevant metadata

Possible sources will be selected later by media type.

Examples under consideration:

- IMDb for movies/TV
- appropriate book databases
- appropriate game databases
- appropriate music/podcast databases

If reliable APIs/sources are difficult, expensive, or legally inconvenient, this feature can be dropped without affecting the core application.

---

## 19. Accounts and synchronization

The application should use a real account system with:

- registration/login
- cloud database
- automatic synchronization
- access from PC and mobile

The deployment goal is:

**free or very low-cost hosting where realistically possible.**

Technology choices should be made later based on:

- simplicity
- free-tier availability
- reliability
- ease of development
- authentication support
- database/storage support
- mobile responsiveness

---

## 20. Responsive design

The application must work well on:

- desktop PC
- mobile phone

Preferred direction:

**App-like responsive web design**

Mobile can have more compact navigation and interactions while remaining the same web application.

If mobile-specific behavior becomes unnecessarily difficult, V1 can start with a strong responsive desktop/mobile layout instead.

---

## 21. Sharing and privacy

The long-term goal includes:

### Public profile

Potentially share the user's library/reviews.

### Individual sharing

Potentially share individual items or lists.

Sharing itself is **not a V1 feature**.

The intended default sharing model is:

**Everything shareable by default.**

Future privacy controls should allow choices such as:

- share everything
- share everything except Notes
- share everything except Review
- share nothing

The data model should leave room for these controls later.

---

## 22. Trash / deletion

Deleting an item should be a **soft delete**.

Deleted items go to Trash rather than disappearing permanently.

Trash should allow:

- restore
- permanent deletion

This protects against accidental deletion.

---

## 23. Import / export

The user should be able to:

### Export

Export their complete library, including as much of the following as practical:

- items
- categories
- subtypes
- statuses
- priorities
- ratings
- tags
- notes
- reviews
- links
- metadata
- lists

A standard machine-readable format such as **JSON** should be supported.

CSV may be useful as an additional export format.

### Import

The user should be able to restore/import exported data.

This prevents lock-in and makes migration/backups possible.

---

## 24. UI/UX direction

The GUI should be a major part of the project rather than an afterthought.

Desired qualities:

- clean
- modern
- visually attractive
- easy to scan
- responsive
- pleasant on mobile
- strong use of cover artwork/cards where appropriate
- clear status/rating/tag indicators
- dashboard with attractive statistics

The design should avoid feeling like a generic spreadsheet/database.

---

# V1 scope summary

## Must have

- [x] Four top-level categories: Games / Books / Audio / Video
- [x] One subtype per item
- [x] Predefined + custom subtypes
- [x] Predefined + custom tags
- [x] Planned / Ongoing / Completed / Dropped
- [x] 1–10 rating
- [x] Low / Medium / High priority
- [x] Notes
- [x] Review
- [x] Optional cover upload
- [x] Source links
- [x] Small file attachments, if technically reasonable
- [x] Search
- [x] Category/subtype filtering
- [x] List view
- [x] Card view
- [x] Sorting
- [x] Dashboard/statistics
- [x] Basic recommendation section
- [x] Custom manual lists
- [x] Quick Add
- [x] Full Add
- [x] Responsive PC/mobile interface
- [x] User accounts
- [x] Cloud synchronization
- [x] Trash/recovery
- [x] Import/export
- [x] Free/low-cost deployment as a major constraint

## Optional / future

- [ ] Automatic metadata lookup
- [ ] Automatic cover retrieval
- [ ] Multiple images per item
- [ ] Smart lists
- [ ] Advanced combined search/filtering
- [ ] Consumption/play/read session history
- [ ] Public profile
- [ ] Individual item/list sharing
- [ ] Fine-grained privacy controls
- [ ] More advanced recommendations
- [ ] Additional statistics
- [ ] External integrations

---

# Important design principle

The core application must **not depend on external metadata services**.

A user should be able to create, organize, search, rate, review, and manage their entire library manually even if every external API disappears.

External integrations should enhance the experience, not define the architecture.

---

# Suggested V1 user flow

1. Create account / log in.
2. Arrive at Dashboard.
3. Click Games / Books / Audio / Video.
4. See library as cards or list.
5. Filter by subtype/status/tags.
6. Use Quick Add to dump something into Planned.
7. Open an item to edit its details.
8. Add rating, Notes, Review, tags, cover and links.
9. Move item through Planned → Ongoing → Completed or Dropped.
10. Use Dashboard to see statistics and choose what to consume next.
11. Organize favorites/intentions into custom lists.
12. Export the library whenever desired.

---

# Architecture priorities

When selecting the technology stack, prioritize:

1. **Simple development**
2. **Excellent responsive UI**
3. **Reliable cloud database**
4. **Simple authentication**
5. **Free/cheap deployment**
6. **Easy file/image storage**
7. **Easy backup/export**
8. **Ability to add external APIs later**
9. **Maintainable codebase**
10. **Ability to evolve into a more sophisticated application without rewriting the core**

---

# Current decisions from brainstorming

1. Purpose → Personal media library covering past/current/planned
2. Categories → Games / Books / Audio / Video
3. Subtypes → One per item; predefined + custom
4. Rating → 1–10
5. Writing → Separate Notes + Review
6. Tags → Predefined + custom
7. Images → One optional cover initially; architecture supports more later
8. Sources → Links + attempted file attachments
9. Search → Basic fields + Notes/Review; advanced later
10. Dashboard → Statistics + lightweight recommendations
11. Library → List + Card views
12. Metadata → Optional external lookup later
13. Accounts → Cloud account + sync, free/simple deployment target
14. Sharing → Future public profile + individual sharing
15. Organization → One library + custom lists
16. Repeated media → One item per work
17. Privacy → Sharing-friendly by default; privacy controls later
18. Item page → Core info + Notes + Review
19. Planned priority → Low / Medium / High
20. Lists → Manual V1, smart later
21. Minimum full item → Title + category + subtype + status
22. Status changes → Manual with helpful prompts
23. Sorting → Recently added by default; Priority/Status alternatives
24. Mobile → App-like responsive if practical; otherwise standard responsive V1
25. Backup → Import + export
26. Deletion → Trash / soft delete
27. Cover → Manual upload; automatic fetching later
28. Subtypes → Predefined per category + custom
29. Subtype count → Exactly one
30. Startup → Remember last screen
31. Adding → Quick Add + Full Add
32. Quick Add → Title + category; creates Planned item

---

## What is intentionally NOT finalized yet

The next planning stage should determine:

- ~~exact subtype lists~~ — decided, see `subtypes-and-tags.md`
- ~~exact predefined tags~~ — decided, see `subtypes-and-tags.md`
- ~~database schema~~ — decided, see `database-schema.md`
- ~~technology stack~~ — decided, see below
- ~~hosting/deployment solution~~ — decided (Vercel + Supabase), see below
- ~~authentication provider~~ — decided (Supabase Auth), see below
- ~~database provider~~ — decided (Supabase/Postgres), see below
- ~~file/image storage solution~~ — decided (Supabase Storage), see `database-schema.md` §7
- ~~project folder/code architecture~~ — decided, see `project-structure.md`
- ~~UI visual direction~~ — decided, see `ui-direction.md` and `ui-style-guide.md`
- exact dashboard statistics — loosely scoped in §14 above, not finalized as concrete widgets
- exact recommendation algorithm — loosely scoped in §14 above, not finalized
- metadata sources/APIs — deliberately deferred; optional future enhancement, not required for V1
- whether attachments are worth keeping — kept in the schema (`item_attachments` table) pending confirmation it doesn't complicate deployment
- ~~security/authentication requirements beyond RLS~~ — decided: email/password + password reset only, no OAuth for V1, see `tasks.md` task 9
- backup strategy beyond user-driven export/import — not detailed further
- ~~V1 milestone breakdown~~ — decided, see `tasks.md`

This document should therefore be treated as the **product scope/specification draft**, together with `database-schema.md`, `subtypes-and-tags.md`, `project-structure.md`, `ui-direction.md`, and `ui-style-guide.md` for the decisions made so far, and `tasks.md` for the ordered V1 backlog (each task also tracked as a GitHub issue). The handful of items still marked open above are either deliberately deferred past V1 or minor enough to resolve inline while doing the relevant task.

---

## Technology stack decision

**Chosen: Next.js + Supabase**

- **Frontend:** Next.js (React) + Tailwind CSS
- **Database:** Supabase (managed Postgres)
- **Auth:** Supabase Auth
- **File/image storage:** Supabase Storage
- **Hosting:** Vercel (frontend) + Supabase cloud (DB/auth/storage), both on free tiers

Rationale: Postgres fits the relational item/tag/list model well and supports the combined filtering the plan calls for (e.g. Games + RPG + Planned + rating ≥ 8). Supabase bundles DB + auth + row-level security + file storage in one product, minimizing integration work. Row-level security also leaves room for the future public-profile/sharing feature without a schema rewrite.

Known tradeoff: free-tier Supabase projects pause after ~7 days of no API activity and require a manual restore via the Supabase dashboard (not an automatic wake like typical serverless cold starts). Mitigation shipped (issue #32): `.github/workflows/supabase-keepalive.yml`, a scheduled GitHub Actions workflow (daily cron, plus manual `workflow_dispatch`) that hits the Supabase project's PostgREST API with the public anon/publishable key — comfortably under the 7-day pause threshold.

Note: Vercel's GitHub integration was connected on 2026-09-10 to auto-deploy `master` pushes to production (issue #32 follow-up).

Note: Vercel's serverless function region is pinned to `fra1` (Frankfurt) via root-level `vercel.json`, to sit next to Supabase's `eu-central-1` project and avoid a transatlantic round trip on every server-rendered request/middleware auth check (issue #51; previously unpinned, defaulting to `iad1`/Washington D.C.).