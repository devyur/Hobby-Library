# Project Folder Structure — Decisions (Draft V1)

Target: Next.js (App Router) + TypeScript + Tailwind + Supabase. No code yet — this is the layout and the reasoning behind it.

---

## 1. Routing: Next.js App Router, with route groups

**Decision:** App Router (not the older Pages Router), with two route groups:
- `(auth)` — public pages: login, register
- `(app)` — everything behind auth, sharing one layout (the nav shell)

**Decision:** the category library view is a **dynamic route** `[category]/`, not four separate folders (`games/`, `books/`, `audio/`, `video/`). This follows directly from the earlier decision that `categories` is a DB-driven table, not a fixed set — the route, the nav, and the page all resolve the category from the database at request time, so adding "Journeys" or "Sport" later needs zero new routes or files.

**Decision:** reads happen directly in Server Components (React Server Components query Supabase server-side, no client-side fetch needed for initial page load); writes go through **Server Actions**, not a separate REST/GraphQL API layer. This avoids hand-building an API layer for a single-consumer app — it's the standard low-ceremony pattern for Next.js + Supabase and directly serves priority #1 in the plan ("simple development"). An `app/api/` route is kept only for the one case that doesn't fit a Server Action well: the JSON/CSV **export download** endpoint.

---

## 2. `src/` directory

**Decision:** application code lives under `src/`, keeping the repo root reserved for config files and the `_docs/`/`supabase/` folders. Purely a cleanliness convention — no functional effect.

---

## 3. `components/` — hybrid organization

**Decision:** split between generic reusable primitives and domain-specific components, rather than one flat folder or one folder per page:
- `components/ui/` — generic primitives (Button, Card, Modal, Input, Badge…). Sourced from **shadcn/ui** (Tailwind-based, copied into the repo rather than pulled in as an opaque dependency, so components stay fully editable and there's no library lock-in).
- `components/items/` — item-specific UI (ItemCard, ItemListRow, ItemForm, StatusBadge, RatingStars…)
- `components/dashboard/` — stat tiles, charts
- `components/lists/` — custom list UI
- `components/nav/` — the main nav shell, which renders its tabs **dynamically from the `categories` table** (per the earlier decision)

Why this split and not "one folder per route": several components (ItemCard, StatusBadge) are reused across the dashboard, category views, and list views — domain folders keep them discoverable without duplicating them per page.

---

## 4. `lib/` — everything non-visual

- `lib/supabase/client.ts` — browser Supabase client
- `lib/supabase/server.ts` — server-side Supabase client (Server Components/Actions need a distinct client because of cookie-based session handling)
- `lib/supabase/types.ts` — DB types generated from the live Supabase schema (`supabase gen types typescript`), regenerated whenever the schema changes — keeps queries type-safe without hand-maintained types drifting from the DB. Regenerating via the literal CLI requires either Docker/Podman on `PATH` (for `--db-url`) or a Supabase personal access token via `SUPABASE_ACCESS_TOKEN` (for `--linked`/`--project-id`). In an environment with neither (e.g. a Docker-less sandbox with no PAT configured), `@supabase/postgrest-typegen` — the same introspection/codegen engine the CLI wraps — run directly against the live schema is the accepted fallback, provided the resulting file's header documents which tool generated it and why the literal CLI wasn't used. See [#7](https://github.com/devyur/Hobby-Library/issues/7) for the decision record.
- `lib/actions/` — Server Actions grouped by domain (`auth.ts`, `items.ts`, `preferences.ts`, plus `tags.ts`/`lists.ts` once #17/#26 land)
- `lib/queries/` — reusable read queries (`getItems`, `getDashboardStats`, …)
- `lib/validation/` — form/input validation schemas (Zod), shared between client forms and server-side Action validation so validation logic isn't duplicated
- `lib/constants.ts` — static lookups not worth a DB round-trip, e.g. status/priority display labels and colors

`src/middleware.ts` — Next.js middleware, used for Supabase session refresh on each request (standard requirement for Supabase SSR auth).

---

## 5. `supabase/` — schema as code

- `supabase/migrations/` — the SQL migration files; `_docs/database-schema.md` becomes the source of truth for *design*, these migrations become the source of truth for the *actual* schema once implementation starts
- `supabase/seed.sql` — inserts the predefined categories/subtypes/tags from `_docs/subtypes-and-tags.md`

Keeping schema as versioned SQL (via the Supabase CLI) rather than only clicking through the dashboard means the schema is reproducible, diffable in git, and restorable if the project ever needs to be rebuilt from scratch — directly serves the plan's "easy backup" and "maintainable codebase" priorities.

---

## 6. Naming conventions

- Route segment folders: `kebab-case`
- Component files: `PascalCase.tsx`
- Utility/hook/action files: `camelCase.ts`

---

## Full tree

```
Hobby Library/
├── _docs/
├── supabase/
│   ├── migrations/
│   └── seed.sql
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── layout.tsx              # centered auth card shell
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   ├── forgot-password/page.tsx
│   │   │   └── reset-password/page.tsx
│   │   ├── auth/
│   │   │   └── confirm/route.ts        # completes the password-recovery email link
│   │   ├── (app)/
│   │   │   ├── layout.tsx              # nav shell (#10)
│   │   │   ├── dashboard/page.tsx      # stats/recommendations pending #27/#28
│   │   │   ├── add/
│   │   │   │   ├── page.tsx            # Full Add form (#14)
│   │   │   │   └── AddItemForm.tsx
│   │   │   ├── [category]/
│   │   │   │   ├── page.tsx            # library list/card view (#12); filters pending #22-24
│   │   │   │   └── [itemId]/page.tsx   # item detail, read-only (#13); editing pending #16
│   │   │   ├── lists/
│   │   │   │   ├── page.tsx            # #10: placeholder until #26
│   │   │   │   └── [listId]/page.tsx
│   │   │   ├── trash/page.tsx          # #10: placeholder until #25
│   │   │   └── settings/page.tsx       # email, logout, theme toggle (#11)
│   │   ├── api/
│   │   │   └── export/route.ts
│   │   ├── layout.tsx                  # root layout
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/
│   │   ├── items/
│   │   ├── dashboard/
│   │   ├── lists/
│   │   └── nav/
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts
│   │   │   ├── server.ts
│   │   │   └── types.ts
│   │   ├── actions/
│   │   ├── queries/
│   │   ├── validation/
│   │   └── constants.ts
│   └── middleware.ts
├── public/
├── .env.example
├── next.config.ts
├── tsconfig.json
└── package.json
```

Tailwind v4 uses its CSS-first `@theme inline` config (in `src/app/globals.css`) rather than a `tailwind.config.ts` file — see [#8](https://github.com/devyur/Hobby-Library/issues/8), no such file exists.

---

## Status

Finalized for V1.
