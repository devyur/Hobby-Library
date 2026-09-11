"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { CoverThumbnail } from "@/components/items/CoverThumbnail";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  addItemToListAction,
  removeItemFromListAction,
  reorderListItemsAction,
} from "@/lib/actions/lists";
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
//
// Manual drag-reordering (issue #42): `items` is also the drag-and-drop
// order now, not just insertion order -- dragging (or keyboard-reordering,
// via @dnd-kit's built-in KeyboardSensor) a row calls reorderListItemsAction
// once per drop with the *entire* new order, optimistically applying it to
// `items` first and rolling back on failure, same shape as handleRemove's
// existing optimistic-update pattern below. A list with fewer than two
// members skips the drag machinery entirely (rendered as a plain list) --
// there's nothing to reorder, so no drag handle is shown at all, per the
// issue's own acceptance criteria.
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
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const pickerId = useId();

  // distance: 5 gives a small drag threshold so a plain click on the handle
  // (e.g. during a keyboard/AT interaction that still dispatches a pointer
  // event) doesn't misfire as a drag; sortableKeyboardCoordinates is
  // dnd-kit's own default arrow-key-to-position mapping, needed for the
  // keyboard-only reordering acceptance criterion.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
      // Appended (issue #42) -- matches addItemToListAction now assigning
      // the new row the highest sort_order in the list, so a freshly-added
      // item always lands after every existing member, the same position a
      // re-fetch of getListDetail would now return it in.
      setItems((current) => [
        ...current,
        {
          id: candidate.id,
          title: candidate.title,
          categorySlug: candidate.categorySlug,
          categoryName: candidate.categoryName,
          subtypeName: candidate.subtypeName,
          coverUrl: null,
        },
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
    // rolled back below if the Server Action fails. The remaining items'
    // relative order is untouched -- they simply keep their existing
    // positions in the filtered array, matching the issue's "removes don't
    // disturb remaining order" acceptance criterion (their sort_order rows
    // in the database are never written by a remove either).
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    setReorderError(null);
    const previousItems = items;
    const nextItems = arrayMove(items, oldIndex, newIndex);
    // Optimistic reorder -- on-screen order updates immediately, no flicker
    // back to the old order while the save is in flight. Rolled back below
    // on failure, same pattern as handleRemove.
    setItems(nextItems);

    startTransition(async () => {
      const result = await reorderListItemsAction(
        listId,
        nextItems.map((item) => item.id),
      );
      if ("error" in result) {
        setItems(previousItems);
        setReorderError(result.error);
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
        ) : items.length === 1 ? (
          // Exactly one member -- nothing to reorder, so no drag machinery
          // is mounted at all (and therefore no non-functional drag
          // handle can render), per the issue's own acceptance criteria.
          <ul className="flex flex-col gap-2">
            <MemberRow
              item={items[0]}
              disabled={isPending}
              removeError={removeErrors[items[0].id]}
              onRemove={handleRemove}
            />
          </ul>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2">
                {items.map((item) => (
                  <SortableMemberRow
                    key={item.id}
                    item={item}
                    disabled={isPending}
                    removeError={removeErrors[item.id]}
                    onRemove={handleRemove}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {reorderError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {reorderError}
          </p>
        ) : null}
      </section>
    </div>
  );
}

// Shared row content between the draggable (2+ items) and plain (0/1 items)
// render paths -- kept as one function so the two paths can't drift apart
// visually.
function MemberRowFields({ item }: { item: ListMemberItem }) {
  return (
    <>
      <div className="w-10 shrink-0">
        <CoverThumbnail coverUrl={item.coverUrl} title={item.title} />
      </div>
      <Link
        href={`/${item.categorySlug}/${item.id}`}
        className="flex min-w-0 flex-1 flex-col hover:underline"
      >
        <span className="truncate text-sm font-medium text-text-primary">{item.title}</span>
        <span className="truncate text-xs text-text-secondary">
          {item.categoryName} · {item.subtypeName}
        </span>
      </Link>
    </>
  );
}

function RemoveButton({
  item,
  disabled,
  removeError,
  onRemove,
}: {
  item: ListMemberItem;
  disabled: boolean;
  removeError?: string;
  onRemove: (item: ListMemberItem) => void;
}) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Remove ${item.title}`}
        disabled={disabled}
        onClick={() => onRemove(item)}
      >
        Remove
      </Button>
      {removeError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {removeError}
        </p>
      ) : null}
    </>
  );
}

// The plain (non-draggable) row, used only for a 0/1-item list -- no
// @dnd-kit hooks/handle involved at all.
function MemberRow({
  item,
  disabled,
  removeError,
  onRemove,
}: {
  item: ListMemberItem;
  disabled: boolean;
  removeError?: string;
  onRemove: (item: ListMemberItem) => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-surface p-2">
      <MemberRowFields item={item} />
      <RemoveButton item={item} disabled={disabled} removeError={removeError} onRemove={onRemove} />
    </li>
  );
}

// The draggable row, used once a list has 2+ members. useSortable is only
// ever called from inside this dedicated component (never inline in a
// .map() in the parent) so the number of hook calls stays fixed per render
// of THIS component, regardless of how many rows the parent renders --
// calling it conditionally a variable number of times per render of the
// same component would break the rules of hooks.
function SortableMemberRow({
  item,
  disabled,
  removeError,
  onRemove,
}: {
  item: ListMemberItem;
  disabled: boolean;
  removeError?: string;
  onRemove: (item: ListMemberItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border border-border bg-surface p-2 ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <button
        type="button"
        aria-label={`Drag to reorder ${item.title}`}
        disabled={disabled}
        // size-11 (44px) shrinking to size-8 at md:, matching Button's own
        // "sm" size -- same WCAG 2.2 SC 2.5.8 / Apple HIG touch-target
        // baseline reasoning as button.tsx's own size variants (issue #31),
        // applied here since this is a brand-new touch target, not a
        // restyle of an existing one.
        className="flex size-11 shrink-0 touch-none items-center justify-center text-text-secondary hover:text-text-primary disabled:pointer-events-none disabled:opacity-50 md:size-8"
        {...attributes}
        {...listeners}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="size-4"
          aria-hidden="true"
        >
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>
      <MemberRowFields item={item} />
      <RemoveButton item={item} disabled={disabled} removeError={removeError} onRemove={onRemove} />
    </li>
  );
}
