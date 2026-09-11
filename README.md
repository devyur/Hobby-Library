# Hobby Library

A personal, single-account app for tracking things to watch, read, listen to, and play — Games, Books, Audio, and Video — through **Planned → Ongoing → Completed/Dropped**, with ratings, notes, reviews, tags, custom lists, and cloud sync across devices.

The design intent (see `_docs/ui-direction.md`) is that an item's page should feel like **your personal record of the work, not a database row** — that framing shows up throughout the UI and in a lot of the smaller decisions below.

Live at: **https://hobby-library.vercel.app**

---

## If you're picking this back up after months away

Read this file first, then `_docs/plan.md` for the full product spec if you need it. The `_docs/` folder is the project's memory — it's meant to be kept current, not a snapshot of planning-time intent (see "Docs map" below). If something in `_docs/` looks wrong or stale next to the actual code, trust the code and fix the doc.

This codebase was built almost entirely through an **orchestrator/subagent AI development process** (`_docs/process.md`): every change went through a PM pass (regroom the issue into concrete acceptance criteria), an Engineer pass (implement + verify live + commit), and an independent QA pass (re-verify live against those criteria) before being closed. That's why the git history and GitHub issues (`devyur/Hobby-Library`) are unusually detailed — closed issues often have real investigation/verification notes worth reading if you're wondering *why* something works the way it does, not just *that* it does.

---

## Tech stack

- **Frontend:** Next.js 16 (App Router, TypeScript) + Tailwind CSS v4 + shadcn/ui primitives (copied in, not a dependency)
- **Backend:** Supabase (managed Postgres, Auth, Storage) — no separate API server
- **Hosting:** Vercel (frontend/functions) + Supabase Cloud, both on free tiers
- Reads happen directly in **Server Components** querying Supabase; writes go through **Server Actions**. There's no REST/GraphQL API layer — the one exception is the export download endpoint (`/api/export`), which has to be a Route Handler because it's a file download, not a form submission.

---

## Running it locally

```bash
npm install
npm run dev      # http://localhost:3000
```

You need a `.env.local` (see `.env.example` for the two required public vars). At minimum:

| Var | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL — required to run the app at all |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key — required to run the app at all |
| `SUPABASE_SERVICE_ROLE_KEY` | Only needed for admin-style scripts/e2e test-account setup (bypasses RLS) — never used by the app itself at runtime |
| `SUPABASE_DB_PASSWORD` | Only needed to push migrations via `supabase db push --db-url ...` |
| `VERCEL_TOKEN` | Only needed for deploy/inspection scripts via the `vercel` CLI or Vercel's API |

**None of these should ever be committed or printed** — `.env.local` is gitignored; treat the service-role key and DB password as full admin credentials.

Other commands:

```bash
npm run build     # production build (also type-checks)
npm run start     # run the production build
npm run test      # Vitest unit/component tests
npm run test:e2e  # Playwright e2e — starts its own dev server automatically
npm run lint      # ESLint
```

---

## Database

Schema lives as versioned SQL in `supabase/migrations/` (17 migrations as of this writing) — that's the source of truth for the *actual* live schema. `_docs/database-schema.md` is the design record (tables, RLS model, storage buckets, reasoning) and should track the migrations, but always trust the migrations if the two ever disagree.

Apply migrations to a live Supabase project with:

```bash
npx supabase db push --db-url "postgresql://postgres.<project-ref>:$SUPABASE_DB_PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
```

(`<project-ref>` comes from `NEXT_PUBLIC_SUPABASE_URL`.) **Committing a migration file is not the same as it being live** — this project got burned by exactly that once (issue #55: a migration for the Dashboard's dismiss/shuffle feature sat committed but unapplied in production for a while). If a feature touching a new column seems broken in production, check `supabase db push --dry-run` before anything else.

Every user-owned table uses row-level security (`user_id = auth.uid()`); predefined/shared rows (categories, subtypes, tags) have `user_id IS NULL`. `src/lib/supabase/types.ts` is generated from the live schema — regenerate it after any schema change (see that file's own header for the exact command; this project has needed a non-Docker fallback via `@supabase/postgrest-typegen` in some environments — issue #7 has the reasoning).

---

## Deployment

Pushing to `origin/master` auto-deploys to Vercel (project `nerde-home/hobby-library`) — this has been confirmed working repeatedly and is the actual deployment mechanism used throughout this project's history; there's no separate manual deploy step.

`vercel.json` pins Vercel's serverless functions to `fra1` (Frankfurt), matching Supabase's `eu-central-1` project region — this was a real, measured fix (issue #51) for a confirmed transatlantic-latency problem (functions were defaulting to `iad1`/US East). **One thing this does NOT fix:** Next.js's routing/`proxy.ts` (the old `middleware.ts`) runs on Vercel's Edge Runtime, which Vercel always executes from the nearest edge location regardless of the `regions` pin — confirmed as a genuine Hobby-plan platform constraint, not a bug in this codebase (issue #58). If navigation ever feels slow again, that's the one place region-pinning structurally can't help; look elsewhere first.

---

## Why things are built this way

A few decisions that aren't obvious from the code alone:

- **No REST/GraphQL API layer.** This is a single-consumer app — Server Components reading Supabase directly and Server Actions for writes is less ceremony than hand-building an API layer, and was an explicit priority ("simple development") from the original plan.
- **`[category]/` is a dynamic route, not `games/`/`books/`/etc.** `categories` is a database table, not a fixed set — adding a new category later (e.g. "Sport") needs zero new routes, files, or nav changes.
- **Tailwind v4, CSS-first config.** Color tokens/theme live in `@theme inline` inside `globals.css` — there's deliberately no `tailwind.config.ts` (issue #8).
- **Cover images are resized and re-encoded to WebP client-side before upload** (issue #37) — keeps Supabase Storage usage and egress low on the free tier, not a quality choice.
- **CSV export is a separate, isolated pure function** (`src/lib/queries/exportCsv.ts`, issue #45), deliberately with zero Supabase imports and no import-side round-trip. JSON (issue #29) is the canonical, full-fidelity, *importable* format; CSV is export-only, for spreadsheet browsing. It was built somewhat speculatively at the user's own request ("we can revert or mute it if it turns out useless") — if it's never used, it's cheap to remove since nothing else depends on it.
- **Notes and Review are independently, always-interactively editable** (issue #48), unlike Rating/Status/Priority which stay behind one shared Edit/Save toggle. This was a deliberate UX split, not an inconsistency — it mirrors how Tags already worked and was a direct response to the shared toggle feeling inconvenient in practice. The "suggest marking Completed" nudge has two different trigger mechanisms as a result: Rating's is block-before-save (in the shared form), Review's is check-after-save (inside its own Server Action, since Review can be saved without the main form ever being open).
- **`created_at`/`deleted_at` render through a dedicated `LocalDate` component**, not a plain formatted string (issue #46) — genuine local-time timestamps can disagree between server-render and client-hydration near a viewer's local midnight, causing a real React hydration mismatch. `LocalDate` renders a UTC-forced stable placeholder for first paint, then swaps to the true local-time string post-mount.
- **The loading-screen GIF is a plain `<img>`, not `next/image`** (issue #59) — `next/image` can freeze an animated GIF to its first frame unless explicitly marked `unoptimized`.
- **`user_preferences.last_screen`** is updated via a fire-and-forget client-side write on every route change (`LastScreenTracker.tsx`) so a user resumes where they left off on next login — intentionally never blocks rendering or surfaces errors.

---

## Current status & what's next

V1's full original backlog (issues #1–#32 in `_docs/tasks.md`) is built and shipped, closed sequentially through the PM→Engineer→QA process described above. Production has been live since, and most issues from #33 onward are user-reported polish/bugs/ideas from actually using the deployed app rather than pre-planned V1 scope — that stream is ongoing, not finished.

Open issues worth knowing about if you're continuing this work — check `gh issue list --repo devyur/Hobby-Library --state open` for the current list, but as of this writing:

- **#57** — the Dashboard's per-category drill-down (#50) shipped as a separate page (`/dashboard/[category]`) reached by clicking a category name, but that name doesn't visually read as a link. There's also an open, larger design question here: the *original* pre-implementation mockup (`_docs/ui-direction.md`) sketched the Dashboard itself as reusable per-category in place, closer to an in-place toggle than a separate page — worth reconsidering the whole interaction, not just the link styling, before investing more here.
- **#60** — `proxy.ts`'s matcher doesn't exclude `public/` static assets, so an unauthenticated request to a public asset gets redirected to `/login` instead of served directly. Doesn't affect anything user-facing today (the only current public asset, the loading GIF, is only ever requested from already-authenticated pages), but it's a real gap.
- **#52, #53, #54, #56** — smaller open items (inline list-creation shortcut, recommendation-ranking tuning, dismissed-recommendation management, one stale e2e assertion). Read them directly on GitHub for current acceptance criteria; they're kept in the groomed task-template format.

---

## Docs map (`_docs/`)

- `plan.md` — full product scope/spec and the running log of what's decided vs. still open
- `database-schema.md` — schema design record (tables, RLS, storage buckets) — migrations are the actual source of truth
- `project-structure.md` — folder layout and the reasoning behind it, kept current with what's actually shipped
- `subtypes-and-tags.md` — predefined subtype lists per category and predefined tags
- `ui-direction.md` / `ui-style-guide.md` — visual direction/personality and concrete design tokens
- `tasks.md` — the full backlog, one entry per GitHub issue, with a short "what shipped" note once done
- `process.md`, `task-template.md`, `team/*.md` — the orchestrator/subagent development process itself, if you want to continue building this way
