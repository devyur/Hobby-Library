# Predefined Subtypes & Tags — Draft V1

These are seed rows for the `subtypes` and `tags` tables (`user_id = NULL`, i.e. global/predefined). The user can add custom subtypes/tags on top of these at any time — this list only needs to be "good enough to start," not exhaustive.

Each category's list ends with **Other**, which doubles as the default subtype Quick Add assigns automatically (per plan §17 — Quick Add needs *some* valid subtype without asking the user to pick one).

---

## Subtypes

### Games
1. RPG
2. Action
3. Adventure
4. Strategy
5. Simulation
6. Puzzle
7. Shooter
8. Platformer
9. Horror
10. Visual Novel
11. Racing
12. Gacha
13. RTS
14. Other

### Books
1. Fiction
2. Non-Fiction
3. Educational
4. Biography
5. Self-Improvement
6. Reference
7. Comic / Graphic Novel
8. Asian Novels
9. Science Papers
10. Other

### Audio
1. Music / Album
2. Podcast
3. Audiobook
4. Audio Drama
5. Lecture / Talk
6. Other

### Video
1. Movie
2. TV Series
3. Documentary
4. Anime
5. Short Film
6. Web / YouTube Series
7. Other

---

## Tags

Tags are global (not category-scoped), matching the plan's example of a Book carrying `programming`/`Python`/`career`. Kept deliberately modest — broad, cross-media, and reusable — since custom tags are cheap to add and an overstuffed predefined list just adds noise to autocomplete.

**Genre / mood**
sci-fi, fantasy, horror, mystery, comedy, drama, romance, historical, dark, cozy, wholesome

**Topic**
programming, science, history, philosophy, business, self-improvement, psychology, politics

**Format / experience**
short, long, series, classic, indie

(24 tags total)

---

## Status

Finalized for V1 seed data.
