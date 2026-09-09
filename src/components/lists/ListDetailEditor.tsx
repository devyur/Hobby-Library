"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";

import { CoverThumbnail } from "@/components/items/CoverThumbnail";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { addItemToListAction, removeItemFromListAction } from "@/lib/actions/lists";
import type { AddableItem, ListMemberItem } from "@/lib/queries/lists";

// lists/[listId]/page.tsx's member-item editor (issue #26), replacing the
// need for a dedicated stub -- this route is new. Always interactive, same
// "server read once, client owns the list after that" precedent as
// TrashList.tsx/ItemLinksEditor.tsx: seeded once from page.tsx's
// server-rendered `initialItems`/`initialAddableItems`, owns both lists as
// local state after that.
//
// Add and Remove keep the picker's candidate pool (`addableItems`) and the
// member list (`items`) in sync purely client-side -- a freshly-added item
// moves out of the picker into the member list (and back again on Remove)
// without a re-fetch, so an already-in-the-list item can never appear twice
// in the picker (the issue's own "excluded from the picker's candidates"
// requirement).
export function ListDetailEditor({
  listId,
  initialItems,
  initialAddableItems,
}: {
  listId: string;
  initialItems: ListMemberItem[];
  initialAddableItems: AddableItem[];
}) {
  const [items, setItems] = useState<ListMemberItem[]>(initialItems);
  const [addableItems, setAddableItems] = useState<AddableItem[]>(initialAddableItems);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const pickerId = useId();

  function clearRemoveError(itemId: string) {
    setRemoveErrors((current) => {
      if (!(itemId in current)) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function handleAddSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItemId) return;

    const candidate = addableItems.find((item) => item.id === selectedItemId);
    if (!candidate) return;

    setAddError(null);

    startTransition(async () => {
      const result = await addItemToListAction(listId, candidate.id);
      if ("error" in result) {
        setAddError(result.error);
        return;
      }
      // Prepended -- matches added_at desc (newest-added-first), the same
      // order a re-fetch of getListDetail would return.
      setItems((current) => [
        {
          id: candidate.id,
          title: candidate.title,
          categorySlug: candidate.categorySlug,
          categoryName: candidate.categoryName,
          subtypeName: candidate.subtypeName,
          coverUrl: null,
        },
        ...current,
      ]);
      setAddableItems((current) => current.filter((item) => item.id !== candidate.id));
      setSelectedItemId("");
    });
  }

  function handleRemove(item: ListMemberItem) {
    clearRemoveError(item.id);

    const previousItems = items;
    const previousAddable = addableItems;
    // Optimistic removal, same pattern as ItemLinksEditor.handleRemove --
    // rolled back below if the Server Action fails.
    setItems((current) => current.filter((row) => row.id !== item.id));
    setAddableItems((current) => [
      {
        id: item.id,
        title: item.title,
        categorySlug: item.categorySlug,
        categoryName: item.categoryName,
        subtypeName: item.subtypeName,
      },
      ...current,
    ]);

    startTransition(async () => {
      const result = await removeItemFromListAction(listId, item.id);
      if ("error" in result) {
        setItems(previousItems);
        setAddableItems(previousAddable);
        setRemoveErrors((current) => ({ ...current, [item.id]: result.error }));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-text-primary">Add an item</h2>

        {addableItems.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {items.length === 0
              ? "You have no items in your library yet. Add something first."
              : "Every item in your library is already in this list."}
          </p>
        ) : (
          <form onSubmit={handleAddSubmit} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={pickerId}>Item</Label>
              <Select
                id={pickerId}
                value={selectedItemId}
                onChange={(event) => setSelectedItemId(event.target.value)}
                disabled={isPending}
              >
                <option value="">Select an item…</option>
                {addableItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} — {item.categoryName} ({item.subtypeName})
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={isPending || !selectedItemId}
            >
              Add to list
            </Button>
          </form>
        )}

        {addError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {addError}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="text-sm text-text-secondary">This list has no items yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-md border border-border bg-surface p-2"
              >
                <div className="w-10 shrink-0">
                  <CoverThumbnail coverUrl={item.coverUrl} title={item.title} />
                </div>
                <Link
                  href={`/${item.categorySlug}/${item.id}`}
                  className="flex min-w-0 flex-1 flex-col hover:underline"
                >
                  <span className="truncate text-sm font-medium text-text-primary">
                    {item.title}
                  </span>
                  <span className="truncate text-xs text-text-secondary">
                    {item.categoryName} · {item.subtypeName}
                  </span>
                </Link>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleRemove(item)}
                >
                  Remove
                </Button>
                {removeErrors[item.id] ? (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {removeErrors[item.id]}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
