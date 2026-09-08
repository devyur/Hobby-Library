-- Predefined seed data for categories, subtypes, tags.
--
-- Source of truth for the value lists: _docs/subtypes-and-tags.md.
-- All rows here are global/predefined: user_id = NULL.
--
-- Idempotent: safe to re-run.
--   - categories: ON CONFLICT (slug) — slug is NOT NULL UNIQUE, no nullability quirk.
--   - subtypes: ON CONFLICT on the (category_id, lower(name), user_id) unique index
--     (created with NULLS NOT DISTINCT in the migration, so repeated NULL user_id rows
--     correctly collide).
--   - tags: no unique constraint is defined on this table per _docs/database-schema.md §3,
--     so idempotency is enforced here via WHERE NOT EXISTS instead of ON CONFLICT.

-- ---------------------------------------------------------------------------
-- categories (4 rows)
-- ---------------------------------------------------------------------------

insert into public.categories (slug, name, sort_order)
values
  ('games', 'Games', 1),
  ('books', 'Books', 2),
  ('audio', 'Audio', 3),
  ('video', 'Video', 4)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- subtypes (37 rows total: Games 14, Books 10, Audio 6, Video 7)
-- ---------------------------------------------------------------------------

insert into public.subtypes (category_id, name, user_id)
select c.id, s.name, null
from (
  values
    ('games', 'RPG'),
    ('games', 'Action'),
    ('games', 'Adventure'),
    ('games', 'Strategy'),
    ('games', 'Simulation'),
    ('games', 'Puzzle'),
    ('games', 'Shooter'),
    ('games', 'Platformer'),
    ('games', 'Horror'),
    ('games', 'Visual Novel'),
    ('games', 'Racing'),
    ('games', 'Gacha'),
    ('games', 'RTS'),
    ('games', 'Other'),
    ('books', 'Fiction'),
    ('books', 'Non-Fiction'),
    ('books', 'Educational'),
    ('books', 'Biography'),
    ('books', 'Self-Improvement'),
    ('books', 'Reference'),
    ('books', 'Comic / Graphic Novel'),
    ('books', 'Asian Novels'),
    ('books', 'Science Papers'),
    ('books', 'Other'),
    ('audio', 'Music / Album'),
    ('audio', 'Podcast'),
    ('audio', 'Audiobook'),
    ('audio', 'Audio Drama'),
    ('audio', 'Lecture / Talk'),
    ('audio', 'Other'),
    ('video', 'Movie'),
    ('video', 'TV Series'),
    ('video', 'Documentary'),
    ('video', 'Anime'),
    ('video', 'Short Film'),
    ('video', 'Web / YouTube Series'),
    ('video', 'Other')
) as s(category_slug, name)
join public.categories c on c.slug = s.category_slug
on conflict (category_id, lower(name), user_id) do nothing;

-- ---------------------------------------------------------------------------
-- tags (24 rows)
-- ---------------------------------------------------------------------------

insert into public.tags (name, user_id)
select t.name, null
from (
  values
    -- Genre / mood (11)
    ('sci-fi'), ('fantasy'), ('horror'), ('mystery'), ('comedy'), ('drama'),
    ('romance'), ('historical'), ('dark'), ('cozy'), ('wholesome'),
    -- Topic (8)
    ('programming'), ('science'), ('history'), ('philosophy'), ('business'),
    ('self-improvement'), ('psychology'), ('politics'),
    -- Format / experience (5)
    ('short'), ('long'), ('series'), ('classic'), ('indie')
) as t(name)
where not exists (
  select 1 from public.tags existing
  where existing.user_id is null
    and lower(existing.name) = lower(t.name)
);
