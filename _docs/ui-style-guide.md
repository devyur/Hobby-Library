# UI Style Guide — Decisions (Draft V1)

Operationalizes the direction in `ui-direction.md` into concrete, implementable tokens. Built as CSS variables from day one for both themes — dark mode is not a later add-on.

---

## 1. Color tokens

### Light theme (Notion/Obsidian-inspired)
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#FAFAF9` | Page background (warm off-white) |
| `--surface` | `#FFFFFF` | Cards, panels, table rows |
| `--border` | `#E7E5E4` | Dividers, card borders |
| `--text-primary` | `#1C1917` | Titles, body text (dark charcoal, not pure black) |
| `--text-secondary` | `#78716C` | Metadata, secondary labels (muted gray) |

### Dark theme (Discord/Steam-inspired, calm not neon)
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#1C1E21` | Page background (dark charcoal, not pure black) |
| `--surface` | `#26282C` | Cards, panels, table rows |
| `--border` | `#35373C` | Dividers, card borders |
| `--text-primary` | `#F4F4F3` | Titles, body text (near-white) |
| `--text-secondary` | `#9A9A97` | Metadata, secondary labels |

### Accent (Indigo/Blue) — used sparingly: primary buttons, links, active nav item, focus rings
| Theme | Hex |
|---|---|
| Light | `#4F46E5` |
| Dark | `#818CF8` |

### Status colors — the primary place color is spent (per the "color-coded statuses" decision); categories stay neutral/icon-based
| Status | Light bg / text | Dark bg / text |
|---|---|---|
| Planned | `#F1F5F9` / `#64748B` (slate) | `#334155` / `#CBD5E1` |
| Ongoing | `#FEF3C7` / `#D97706` (amber) | `#78350F` / `#FCD34D` |
| Completed | `#DCFCE7` / `#16A34A` (green) | `#14532D` / `#86EFAC` |
| Dropped | `#FFE4E6` / `#E11D48` (rose — muted, deliberately not alarm-red; dropping something isn't a failure) | `#881337` / `#FDA4AF` |

### Rating badge
Neutral, not color-scaled by value — color stays reserved for status. Plain pill using `--surface`/`--border`/`--text-primary`, format **"9/10"** (per the numeric-badge decision, no star icon).

---

## 2. Typography

- **Font:** Inter, fallback `system-ui, -apple-system, sans-serif`. Chosen for legibility at small/dense sizes (list rows) while still reading cleanly at larger sizes (item titles).
- One font family for V1 — no separate display/heading font, keeping it simple to implement.
- Item detail page titles get more visual weight (larger size, semibold) to support the "personal record" feel; list/table text stays smaller and regular-weight to support density.

---

## 3. Density & layout

- **Library views (list & card): compact/dense.** List rows ~44px tall, tight padding. Card grid uses smaller cover thumbnails than the original mockup — more cards per row (aiming for scanability over poster-sized art).
- **Item detail page: the deliberate exception.** Spacious, editorial layout with a large cover and generous whitespace — this is the one place the "personal record, not a database row" feeling should dominate, per `ui-direction.md`.
- **Dashboard:** moderate spacing, stat tiles + recommendation cards roughly as sketched in `ui-direction.md`.
- Cover art stays optional everywhere — per `ui-direction.md`'s note, an item with no cover must still render cleanly (placeholder treatment, not a broken/empty box), since a dense card grid will often contain many uncovered items.

---

## 4. Theme switching

- Implemented via CSS variables switched by a `data-theme` attribute (or Tailwind `dark:` variant).
- Defaults to the OS/browser's `prefers-color-scheme` on first load.
- Manually overridable via a toggle in Settings.
- The choice is **persisted server-side** (not just `localStorage`) in a new `user_preferences` table (see `database-schema.md` update), so it syncs across devices — consistent with the app's cloud-sync goal, and the same table now also carries the "remember last screen" (plan §15) and "remember sort preference" (plan §13) requirements in one place.

---

## Status

Finalized for V1.
