-- Search (issue #22): pg_trgm extension + trigram GIN indexes enabling fast
-- partial-word ILIKE search across items.title/notes/review and tags.name,
-- plus the search_item_ids() function the search query itself calls.
--
-- Design record: _docs/database-schema.md §5. None of this -- the pg_trgm
-- extension, any of the four trigram GIN indexes, or a search RPC --
-- existed in a prior migration; nothing filed before #22 needed
-- partial-word search.

create extension if not exists pg_trgm;

create index if not exists items_title_trgm_idx
  on public.items using gin (title gin_trgm_ops);

create index if not exists items_notes_trgm_idx
  on public.items using gin (notes gin_trgm_ops);

create index if not exists items_review_trgm_idx
  on public.items using gin (review gin_trgm_ops);

create index if not exists tags_name_trgm_idx
  on public.tags using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- search_item_ids: the one-query implementation of §5's OR'd match --
-- title/notes/review ILIKE'd directly against items, tag-name matches via an
-- EXISTS join through item_tags -> tags (tags is a separate table, not a
-- column on items, so it can't share the three trigram indexes above).
-- ---------------------------------------------------------------------------
--
-- Plain `language sql` + `security invoker` (the Postgres default, spelled
-- out here for clarity): runs with the calling user's own privileges, so the
-- existing items_select_own / item_tags_select_own / tags select RLS
-- policies (database-schema.md §4) still fully apply -- this function grants
-- no additional visibility, it only changes how the WHERE clause is
-- expressed. category_id and deleted_at are both filtered here explicitly
-- (matching getLibraryItems' own unfiltered query) rather than left to RLS
-- alone, so a caller passing another category's id gets zero rows, never a
-- cross-category leak.
--
-- No `%`/`_` escaping on p_search_term -- per issue #22's acceptance
-- criteria, this box does exactly one thing (raw partial-word ILIKE), and an
-- impractically-broad wildcard character in the term is expected to still
-- work, not error.
create or replace function public.search_item_ids(
  p_category_id uuid,
  p_search_term text
)
returns table (id uuid)
language sql
stable
security invoker
as $$
  select items.id
  from public.items as items
  where items.category_id = p_category_id
    and items.deleted_at is null
    and (
      items.title ilike '%' || p_search_term || '%'
      or items.notes ilike '%' || p_search_term || '%'
      or items.review ilike '%' || p_search_term || '%'
      or exists (
        select 1
        from public.item_tags
        join public.tags on tags.id = item_tags.tag_id
        where item_tags.item_id = items.id
          and tags.name ilike '%' || p_search_term || '%'
      )
    )
  order by items.created_at desc;
$$;

grant execute on function public.search_item_ids(uuid, text) to authenticated;
