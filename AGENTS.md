# Hobby Library

A personal cross-media library for tracking things to watch, read, listen to, and play (Games / Books / Audio / Video), through Planned → Ongoing → Completed/Dropped, with ratings, notes, reviews, tags, custom lists, and cloud sync across devices. Full product spec: `_docs/plan.md`.

## Status

Planning is complete; implementation has not started. The V1 backlog is 32 tasks in `_docs/tasks.md`, each also filed as a GitHub issue (#1–#32) on `devyur/Hobby-Library` — work through them roughly in order starting with #1. Each task is written to be self-contained (it names which doc to check for detail), so a fresh session can pick up any task without reading prior history.

## Docs map (`_docs/`)

- `plan.md` — product scope/spec, V1 must-haves, and the running log of what's decided vs. still open
- `database-schema.md` — full Postgres/Supabase schema: tables, RLS model, storage buckets, search approach
- `subtypes-and-tags.md` — finalized predefined subtype lists per category and predefined tags
- `project-structure.md` — folder layout and the reasoning behind it
- `ui-direction.md` — visual direction/personality (mockup sketches, the "personal record, not a database row" framing)
- `ui-style-guide.md` — concrete color tokens (light + dark), typography, density, rating/status styling
- `tasks.md` — the ordered V1 backlog, linked to GitHub issues

When a task's implementation reveals a decision the docs don't cover, update the relevant doc in the same change — these docs are meant to stay current, not frozen at planning time.

## Tech stack

- **Frontend:** Next.js (App Router, TypeScript) + Tailwind CSS, shadcn/ui primitives
- **Backend:** Supabase (managed Postgres, Auth, Storage)
- **Hosting:** Vercel (frontend) + Supabase cloud, both free tier
- Reads happen in Server Components querying Supabase directly; writes go through Server Actions — no separate REST/GraphQL API layer except the one export download route.

## Conventions

- `src/app` uses route groups: `(auth)` for public pages, `(app)` for the authenticated shell. Category library pages are the dynamic route `[category]/`, not one folder per category — `categories` is a DB table, not a fixed set, so nothing should hardcode the four V1 categories.
- `src/components/ui/` = generic primitives (shadcn/ui, copied in, not a runtime dependency); domain UI lives in `src/components/{items,dashboard,lists,nav}/`.
- `src/lib/supabase/` holds the browser client, server client, and DB types generated via `supabase gen types typescript` — regenerate after any schema change.
- Schema changes are SQL migrations under `supabase/migrations/`, not dashboard-only edits — `database-schema.md` is the design record, migrations are the source of truth for the live schema.
- All user-owned tables use per-user Row-Level Security (`user_id = auth.uid()`); predefined/global rows (subtypes, tags, categories) have `user_id IS NULL`.
- Naming: route folders `kebab-case`, component files `PascalCase.tsx`, utility/action files `camelCase.ts`.

## Commands

Not yet established — task 1 (`_docs/tasks.md`) sets up the project scaffold and test runner. Update this section once that lands.
