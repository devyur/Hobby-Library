### My rough direction: **Cozy Editorial + Clean Minimal + Data-Dense**

Think of it as:

> **“A personal media journal that happens to be an efficient database.”**

#### Overall shell

- Clean, spacious layout inspired by Linear/Notion.
- Neutral background rather than strong colors.
- Left sidebar on desktop:
    - Games
    - Books
    - Audio
    - Video
    - Lists
- Bottom/compact navigation on mobile.
- One restrained accent color for interactive elements.

#### Dashboard (for each type like Games/Video/etc)

More **editorial/personal** than Airtable.

Imagine:

```
┌──────────────────────────────────────────────────────────┐
│  Good evening, Jack                    + Add something    │
│                                                          │
│  Your library                                            │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐             │
│  │  124   │ │   18   │ │    3   │ │   91   │             │
│  │ Total  │ │Planned │ │Ongoing │ │Finished│             │
│  └────────┘ └────────┘ └────────┘ └────────┘             │
│                                                          │
│  Continue / Pick something                               │
│  ┌────────┐ ┌────────┐ ┌────────┐                        │
│  │ COVER  │ │ COVER  │ │ COVER  │                        │
│  │        │ │        │ │        │                        │
│  │ Dune   │ │ Game X │ │ Anime  │                        │
│  │ 9/10   │ │ 8/10   │ │ 9/10   │                        │
│  └────────┘ └────────┘ └────────┘                        │
│                                                          │
│  Library statistics                                      │
│  [ charts / rating distribution / category breakdown /etc]   │
└──────────────────────────────────────────────────────────┘
```

The **cover art gives it personality**, while whitespace keeps it from feeling like Steam.

---

### Category page

This is where I'd borrow heavily from **efficient/data-dense** design.

For example, Books:

```
Books                                      + Add Book

[All] [Fiction] [Educational] [Non-fiction] [+ Filter]

Search books...                         Sort: Recently added

┌─────────────────────────────────────────────────────────────┐
│ COVER │ Python Crash Course     │ 9/10│ Planned │ Education │
│       │                         │     │         │ Python    │
├───────┼─────────────────────────┼─────┼─────────┼───────────┤
│ COVER │ Dune                    │ 9/10│ Complete│ Sci-fi    │
│       │                         │     │         │ Classic   │
├───────┼─────────────────────────┼─────┼─────────┼───────────┤
│ COVER │ Book X                  │ 7/10│ Ongoing │ History   │
└─────────────────────────────────────────────────────────────┘

                         [ List ] [ Cards ]
```

And Cards would become something like:

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│          │  │          │  │          │
│  COVER   │  │  COVER   │  │  COVER   │
│          │  │          │  │          │
├──────────┤  ├──────────┤  ├──────────┤
│ Dune     │  │ Book X   │  │ Book Y   │
│ 9/10     │  │ 8/10     │  │ 7/10     │
│ Completed│  │ Planned  │  │ Ongoing  │
│ sci-fi   │  │ Python   │  │ history  │
└──────────┘  └──────────┘  └──────────┘
```

So **list = efficiency**, **cards = enjoyment**.

---

### Item page

This is where I'd go most strongly toward **Goodreads/Letterboxd/editorial**.

Large cover on the left, information on the right:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ┌─────────────┐       Dune                                │
│   │             │       Frank Herbert                       │
│   │    COVER    │                                             │
│   │             │       9/10                                │
│   │             │       Completed · Fiction                  │
│   │             │                                             │
│   └─────────────┘       [sci-fi] [classic] [space]          │
│                                                             │
│                         Sources: [IMDb] [Website]            │
│                                                             │
│   My notes                                                  │
│   ───────────────────────────────────────────────────────   │
│   ...                                                        │
│                                                             │
│   My review                                                 │
│   ───────────────────────────────────────────────────────   │
│   ...                                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

This page should feel like **your personal record of the work**, rather than a database record.

---

## The visual personality

I'd avoid the extremes:

**Not this:**

> 🟦🟪🟩 A dashboard drowning in glowing neon cards everywhere. (The dark theme can still borrow Discord/Steam's calm dark-charcoal tone — just not the neon-heavy styling on top of it.)

And not this:

> ▦ ▦ ▦ ▦ Airtable spreadsheet with tiny text everywhere.

Instead:

Linear's cleanliness + Letterboxd/Goodreads' personal collection feeling + Airtable's efficiency when browsing. Maybe something similar to Notion/Obsidian as well.

### Color direction

I'd start with:

Two palettes, both built from day one (not dark-mode-as-afterthought):

- **Light theme** — Notion/Obsidian-like: warm/off-white background, dark charcoal text, muted gray secondary text.
- **Dark theme** — Discord/Steam-like: dark charcoal (not pure black) background, near-white text, muted light-gray secondary text.
- One shared accent color, tuned per theme for contrast.
- **Status gets the color budget** (Planned/Ongoing/Completed/Dropped each get a distinct color) rather than category — categories stay neutral/icon-based.
- Artwork still provides most of the visual color/personality on top of that.

A manual theme toggle, defaulting to the system preference on first load. See `ui-style-guide.md` for the actual color tokens.

### One particularly important design choice

I would make **cover art optional rather than mandatory for the visual system**.

If you have 200 games/books without covers, the application should still look beautiful. The UI shouldn't collapse into an ugly empty-card grid.
