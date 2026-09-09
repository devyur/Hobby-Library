"use client";

import { useId, useMemo, useState, useTransition } from "react";
import type { KeyboardEvent } from "react";

import { addTagToItemAction, attachTagAction, detachTagAction } from "@/lib/actions/tags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { tagNameSchema } from "@/lib/validation/tags";

export interface TagOption {
  id: string;
  name: string;
}

const MAX_SUGGESTIONS = 8;

// Always-interactive Tags section for the item detail page (issue #17) --
// unlike the rest of ItemEditForm.tsx (#16), this is never gated behind that
// component's isEditing state: a user can attach/detach tags without first
// clicking "Edit," and doing so never touches or requires saving status/
// rating/priority/notes/review. Each attach/detach below is its own
// immediate Server Action call, not part of any form submission.
//
// `tags`/`onTagsChange` are controlled by ItemEditForm rather than owned as
// local state here: ItemEditForm's own view/edit toggle renders two
// entirely different JSX trees (a plain <div> vs a <form>), which unmounts
// and remounts this component on every toggle -- owning the attached-tags
// list locally would silently discard any attach/detach made just before
// switching modes. Holding it in the parent (which never unmounts) survives
// that.
//
// `suggestionPool` is every tag visible to the signed-in user (predefined +
// their own custom tags) at page-load time -- the same scope
// getTags()/lib/queries/tags.ts already resolves for the Full Add form's
// checkbox list, reused here as the autocomplete data source. A tag created
// in this session is appended to the local pool too, so retyping the same
// name later in the same mount suggests it instead of re-triggering the
// create path.
export function ItemTagsEditor({
  itemId,
  tags,
  onTagsChange,
  suggestionPool,
}: {
  itemId: string;
  tags: TagOption[];
  onTagsChange: (tags: TagOption[]) => void;
  suggestionPool: TagOption[];
}) {
  const [pool, setPool] = useState<TagOption[]>(suggestionPool);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputId = useId();
  const errorId = useId();

  const attachedIds = useMemo(() => new Set(tags.map((tag) => tag.id)), [tags]);

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return pool
      .filter((tag) => !attachedIds.has(tag.id) && tag.name.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [pool, query, attachedIds]);

  function addTagLocally(tag: TagOption) {
    if (!tags.some((t) => t.id === tag.id)) {
      onTagsChange([...tags, tag]);
    }
    setPool((current) => (current.some((t) => t.id === tag.id) ? current : [...current, tag]));
  }

  function handleDetach(tag: TagOption) {
    setError(null);
    const previous = tags;
    // Optimistic removal -- its own independent action, doesn't touch or
    // wait on any other tag.
    onTagsChange(tags.filter((t) => t.id !== tag.id));

    startTransition(async () => {
      const result = await detachTagAction(itemId, tag.id);
      if ("error" in result) {
        onTagsChange(previous);
        setError(result.error);
      }
    });
  }

  function handleSelectSuggestion(tag: TagOption) {
    setError(null);
    setQuery("");

    startTransition(async () => {
      const result = await attachTagAction(itemId, tag.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      addTagLocally(result.tag);
    });
  }

  function handleSubmitTyped() {
    // Client-side rejection of empty/whitespace-only input, mirroring the
    // server-side tagNameSchema re-check in addTagToItemAction.
    const parsed = tagNameSchema.safeParse({ name: query });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a tag name");
      return;
    }
    setError(null);
    setQuery("");

    startTransition(async () => {
      const result = await addTagToItemAction(itemId, parsed.data.name);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      addTagLocally(result.tag);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmitTyped();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-text-primary">Tags</h2>

      {tags.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <li key={tag.id}>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-text-secondary">
                {tag.name}
                <button
                  type="button"
                  aria-label={`Remove ${tag.name}`}
                  onClick={() => handleDetach(tag)}
                  disabled={isPending}
                  className="rounded-full text-text-secondary hover:text-text-primary disabled:pointer-events-none disabled:opacity-50"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative flex max-w-sm items-center gap-2">
        <Label htmlFor={inputId} className="sr-only">
          Add a tag
        </Label>
        <Input
          id={inputId}
          type="text"
          placeholder="Add a tag…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isPending}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSubmitTyped}
          disabled={isPending || query.trim() === ""}
        >
          Add
        </Button>

        {suggestions.length > 0 ? (
          <ul className="absolute top-full left-0 z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-border bg-surface shadow-md">
            {suggestions.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  onClick={() => handleSelectSuggestion(tag)}
                  disabled={isPending}
                  className="block w-full px-2.5 py-1.5 text-left text-sm text-text-primary hover:bg-bg disabled:pointer-events-none disabled:opacity-50"
                >
                  {tag.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
