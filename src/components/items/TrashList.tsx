"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { permanentlyDeleteItemAction, restoreItemAction } from "@/lib/actions/trash";
import type { TrashedItem } from "@/lib/queries/trash";

// Trash page's row list (issue #25) -- a client component so Restore can
// remove its own row without a full page reload (acceptance criteria), and
// so Permanent Delete's inline confirmation panel (no Dialog primitive
// exists, per the issue's Constraints -- same `showNudge`-style pattern
// ItemEditForm.tsx already uses) can live per-row. Seeded once from
// page.tsx's server-rendered `initialItems`, then owns its own local list
// state -- same "server read once, client owns the list after that"
// precedent as ItemLinksEditor/ItemAttachmentsEditor.
//
// Only one row's confirm panel is open at a time (confirmDeleteId), which
// also keeps every row's "Confirm"/"Cancel" pair unambiguous for anything
// driving this page (e.g. Playwright) without needing to scope by row.
export function TrashList({ initialItems }: { initialItems: TrashedItem[] }) {
  const [items, setItems] = useState<TrashedItem[]>(initialItems);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  function clearError(itemId: string) {
    setErrors((current) => {
      if (!(itemId in current)) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function handleRestore(item: TrashedItem) {
    clearError(item.id);
    setPendingId(item.id);
    startTransition(async () => {
      const result = await restoreItemAction(item.id);
      setPendingId(null);
      if ("error" in result) {
        setErrors((current) => ({ ...current, [item.id]: result.error }));
        return;
      }
      setItems((current) => current.filter((row) => row.id !== item.id));
    });
  }

  function handlePermanentDelete(item: TrashedItem) {
    clearError(item.id);
    setPendingId(item.id);
    startTransition(async () => {
      const result = await permanentlyDeleteItemAction(item.id);
      setPendingId(null);
      if ("error" in result) {
        setErrors((current) => ({ ...current, [item.id]: result.error }));
        return;
      }
      setConfirmDeleteId(null);
      setItems((current) => current.filter((row) => row.id !== item.id));
    });
  }

  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">Trash is empty.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => {
        const isPending = pendingId === item.id;
        return (
          <li
            key={item.id}
            className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-text-primary">{item.title}</span>
                <span className="text-sm text-text-secondary">
                  {item.categoryName} · {item.subtypeName} · Deleted{" "}
                  {formatDate(item.deletedAt)}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleRestore(item)}
                >
                  {isPending ? "Restoring…" : "Restore"}
                </Button>
                {confirmDeleteId !== item.id ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => setConfirmDeleteId(item.id)}
                  >
                    Delete Permanently
                  </Button>
                ) : null}
              </div>
            </div>

            {errors[item.id] ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {errors[item.id]}
              </p>
            ) : null}

            {confirmDeleteId === item.id ? (
              <div className="flex flex-col gap-3 rounded-md border border-border bg-bg p-3">
                <p className="text-sm text-text-primary">
                  Permanently delete &ldquo;{item.title}&rdquo;? This cannot be undone — its
                  cover, attachments, tags, links, and any list memberships go with it.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    disabled={isPending}
                    onClick={() => handlePermanentDelete(item)}
                  >
                    {isPending ? "Deleting…" : "Confirm"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
