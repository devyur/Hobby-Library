"use client";

import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";

import { addLinkAction, removeLinkAction } from "@/lib/actions/links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { itemLinkSchema } from "@/lib/validation/links";

export interface LinkOption {
  id: string;
  url: string;
  label: string | null;
}

// Always-interactive Links section for the item detail page (issue #20),
// replacing the read-only ItemLinks.tsx (#13). Same #17/ItemTagsEditor
// precedent: never gated behind ItemEditForm's (#16) isEditing state, so a
// user can add/remove a link without first clicking "Edit," and doing so
// never touches or requires saving status/rating/priority/notes/review.
//
// Unlike ItemTagsEditor, this is rendered directly by page.tsx, not inside
// ItemEditForm -- it never gets unmounted/remounted by that component's view
// vs. edit toggle, so (unlike tags, which need their attached list lifted to
// the never-unmounting parent) it can safely own its `links` list as local
// state, seeded once from the server-rendered `initialLinks` prop.
export function ItemLinksEditor({
  itemId,
  initialLinks,
}: {
  itemId: string;
  initialLinks: LinkOption[];
}) {
  const [links, setLinks] = useState<LinkOption[]>(initialLinks);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const urlInputId = useId();
  const labelInputId = useId();
  const errorId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Client-side pre-check, mirroring the server-side itemLinkSchema
    // re-check in addLinkAction -- malformed URL/non-http(s) scheme/empty
    // URL never even attempts the Server Action call.
    const parsed = itemLinkSchema.safeParse({ url, label });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid URL.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await addLinkAction(itemId, parsed.data.url, parsed.data.label ?? "");
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // New link is inserted with the newest created_at -- appending keeps
      // the list in insertion order without a re-fetch.
      setLinks((current) => [...current, result.link]);
      setUrl("");
      setLabel("");
    });
  }

  function handleRemove(link: LinkOption) {
    setError(null);
    const previous = links;
    // Optimistic removal -- its own independent action, doesn't touch or
    // wait on any other link, matching ItemTagsEditor.handleDetach.
    setLinks((current) => current.filter((l) => l.id !== link.id));

    startTransition(async () => {
      const result = await removeLinkAction(itemId, link.id);
      if ("error" in result) {
        setLinks(previous);
        setError(result.error);
      }
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-text-primary">Links</h2>

      {links.length === 0 ? (
        <p className="text-sm text-text-secondary">No links yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.id} className="flex items-center gap-1.5">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline"
              >
                {link.label || link.url}
              </a>
              <button
                type="button"
                aria-label={`Remove ${link.label || link.url}`}
                onClick={() => handleRemove(link)}
                disabled={isPending}
                // -m-1.5 offsets the added padding so the row doesn't grow
                // -- see ItemTagsEditor.tsx's remove button for the same
                // pattern/rationale (issue #31).
                className="-m-1.5 rounded-full p-1.5 text-text-secondary hover:text-text-primary disabled:pointer-events-none disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={urlInputId}>URL</Label>
          <Input
            id={urlInputId}
            type="text"
            placeholder="https://example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={isPending}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={labelInputId}>Label (optional)</Label>
          <Input
            id={labelInputId}
            type="text"
            placeholder="e.g. IMDb"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={isPending}
            autoComplete="off"
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={isPending || url.trim() === ""}
        >
          Add
        </Button>
      </form>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
