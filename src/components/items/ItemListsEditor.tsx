"use client";

import Link from "next/link";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { addItemToListAction, removeItemFromListAction } from "@/lib/actions/lists";
import type { ListMembership } from "@/lib/queries/lists";

// Always-interactive Lists section for the item detail page (issue #41) --
// an add-to-list shortcut, same #17/ItemTagsEditor / #20/ItemLinksEditor
// precedent: never gated behind ItemEditForm's (#16) isEditing state, so a
// user can add/remove the item from a list without first clicking "Edit,"
// or navigating to lists/[listId]/page.tsx's own picker
// (ListDetailEditor.tsx), which this doesn't replace or change.
//
// Rendered directly by page.tsx, not inside ItemEditForm -- like
// ItemLinksEditor/ItemAttachmentsEditor, it never gets unmounted/remounted
// by that component's view vs. edit toggle, so it can safely own its
// `lists` list as local state, seeded once from the server-rendered
// `initialLists` prop (getListsForItem, lib/queries/lists.ts).
//
// Each checkbox's add/remove is its own independent optimistic
// toggle-then-rollback (ListDetailEditor.handleRemove / ItemTagsEditor.
// handleDetach precedent) -- but keyed by list id via a functional update
// rather than a single whole-array before/after snapshot, so toggling one
// list while another toggle is still in flight can never clobber that
// other list's state when one of them rolls back (the issue's
// "multiple-lists case" acceptance criterion). Pending state is likewise
// tracked per list id, not globally, so one in-flight request never
// disables every other list's checkbox.
//
// Reuses addItemToListAction/removeItemFromListAction unchanged (the
// issue's own Constraints: no new Server Actions) -- both already re-check
// list/item ownership server-side, both already write/delete exactly one
// list_items row (a fresh row lands at its schema default sort_order of 0,
// untouched here -- ordering UI is #42), and addItemToListAction already
// treats a duplicate-insert (23505, e.g. a stale double-click re-checking
// an already-checked box) as a no-op success, so no extra guard against
// double-submission is added here.
export function ItemListsEditor({
  itemId,
  initialLists,
}: {
  itemId: string;
  initialLists: ListMembership[];
}) {
  const [lists, setLists] = useState<ListMembership[]>(initialLists);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  function clearError(listId: string) {
    setErrors((current) => {
      if (!(listId in current)) return current;
      const next = { ...current };
      delete next[listId];
      return next;
    });
  }

  function handleToggle(list: ListMembership, checked: boolean) {
    clearError(list.id);

    // Optimistic update of just this one list's membership.
    setLists((current) =>
      current.map((l) => (l.id === list.id ? { ...l, isMember: checked } : l)),
    );
    setPendingIds((current) => new Set(current).add(list.id));

    const action = checked ? addItemToListAction : removeItemFromListAction;

    action(list.id, itemId).then((result) => {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(list.id);
        return next;
      });
      if ("error" in result) {
        // Roll back only this list's membership -- never touches any other
        // list's (possibly also in-flight) state.
        setLists((current) =>
          current.map((l) => (l.id === list.id ? { ...l, isMember: !checked } : l)),
        );
        setErrors((current) => ({ ...current, [list.id]: result.error }));
      }
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-text-primary">Lists</h2>

      {lists.length === 0 ? (
        <p className="text-sm text-text-secondary">
          {"You don't have any lists yet. "}
          <Link href="/lists" className="text-accent hover:underline">
            Create one
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lists.map((list) => (
            <li key={list.id} className="flex flex-col gap-0.5">
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <Checkbox
                  checked={list.isMember}
                  disabled={pendingIds.has(list.id)}
                  onChange={(event) => handleToggle(list, event.target.checked)}
                />
                {list.name}
              </label>
              {errors[list.id] ? (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {errors[list.id]}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
