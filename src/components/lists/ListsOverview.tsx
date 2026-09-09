"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createListAction,
  deleteListAction,
  renameListAction,
} from "@/lib/actions/lists";
import type { ListSummary } from "@/lib/queries/lists";
import { listNameSchema } from "@/lib/validation/lists";

// lists/page.tsx's list-of-lists (issue #26), replacing #10's stub. Always
// interactive -- same "server read once, client owns the list after that"
// precedent as TrashList.tsx/ItemLinksEditor.tsx, seeded once from
// page.tsx's server-rendered `initialLists`.
//
// Create/Rename share one client pre-check + server re-check pattern (the
// same listNameSchema on both sides, matching itemLinkSchema/tagNameSchema
// elsewhere) -- a blank/whitespace-only name is rejected inline, never
// silently trimmed to empty or silently accepted. Delete uses TrashList's
// inline confirm-panel precedent: only one row's rename form or delete
// confirm is open at a time, keeping "Confirm"/"Cancel"/"Save" unambiguous
// for anything driving this page (e.g. Playwright).
export function ListsOverview({ initialLists }: { initialLists: ListSummary[] }) {
  const [lists, setLists] = useState<ListSummary[]>(initialLists);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const nameInputId = useId();
  const createErrorId = useId();

  function clearRowError(listId: string) {
    setRowErrors((current) => {
      if (!(listId in current)) return current;
      const next = { ...current };
      delete next[listId];
      return next;
    });
  }

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = listNameSchema.safeParse({ name: newName });
    if (!parsed.success) {
      setCreateError(parsed.error.issues[0]?.message ?? "Enter a list name.");
      return;
    }
    setCreateError(null);

    startTransition(async () => {
      const result = await createListAction(parsed.data.name);
      if ("error" in result) {
        setCreateError(result.error);
        return;
      }
      setLists((current) => [{ ...result.list, itemCount: 0 }, ...current]);
      setNewName("");
    });
  }

  function startRename(list: ListSummary) {
    setConfirmDeleteId(null);
    clearRowError(list.id);
    setRenamingId(list.id);
    setRenameValue(list.name);
    setRenameError(null);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
    setRenameError(null);
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>, list: ListSummary) {
    event.preventDefault();

    const parsed = listNameSchema.safeParse({ name: renameValue });
    if (!parsed.success) {
      setRenameError(parsed.error.issues[0]?.message ?? "Enter a list name.");
      return;
    }
    const nextName = parsed.data.name;
    setRenameError(null);

    startTransition(async () => {
      const result = await renameListAction(list.id, nextName);
      if ("error" in result) {
        setRenameError(result.error);
        return;
      }
      setLists((current) =>
        current.map((row) => (row.id === list.id ? { ...row, name: nextName } : row)),
      );
      setRenamingId(null);
    });
  }

  function handleDelete(list: ListSummary) {
    clearRowError(list.id);
    startTransition(async () => {
      const result = await deleteListAction(list.id);
      if ("error" in result) {
        setRowErrors((current) => ({ ...current, [list.id]: result.error }));
        return;
      }
      setConfirmDeleteId(null);
      setLists((current) => current.filter((row) => row.id !== list.id));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleCreateSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={nameInputId}>New list name</Label>
          <Input
            id={nameInputId}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={isPending}
            aria-invalid={!!createError}
            aria-describedby={createError ? createErrorId : undefined}
            autoComplete="off"
            placeholder="e.g. Play next"
          />
        </div>
        <Button type="submit" disabled={isPending || newName.trim() === ""}>
          Create list
        </Button>
      </form>
      {createError ? (
        <p id={createErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {createError}
        </p>
      ) : null}

      {lists.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No lists yet. Create your first one above.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lists.map((list) => (
            <li
              key={list.id}
              className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3"
            >
              {renamingId === list.id ? (
                <form
                  onSubmit={(event) => handleRenameSubmit(event, list)}
                  className="flex flex-wrap items-end gap-2"
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`rename-${list.id}`}>List name</Label>
                    <Input
                      id={`rename-${list.id}`}
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      disabled={isPending}
                      aria-invalid={!!renameError}
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isPending || renameValue.trim() === ""}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={cancelRename}
                  >
                    Cancel
                  </Button>
                  {renameError ? (
                    <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
                      {renameError}
                    </p>
                  ) : null}
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={`/lists/${list.id}`}
                    className="flex min-w-0 flex-1 flex-col hover:underline"
                  >
                    <span className="truncate font-medium text-text-primary">{list.name}</span>
                    <span className="text-sm text-text-secondary">
                      {list.itemCount} {list.itemCount === 1 ? "item" : "items"}
                    </span>
                  </Link>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => startRename(list)}
                    >
                      Rename
                    </Button>
                    {confirmDeleteId !== list.id ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => {
                          setRenamingId(null);
                          setConfirmDeleteId(list.id);
                        }}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}

              {rowErrors[list.id] ? (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {rowErrors[list.id]}
                </p>
              ) : null}

              {confirmDeleteId === list.id ? (
                <div className="flex flex-col gap-3 rounded-md border border-border bg-bg p-3">
                  <p className="text-sm text-text-primary">
                    Delete &ldquo;{list.name}&rdquo;? The list is removed, but the items in it
                    stay in your library.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleDelete(list)}
                    >
                      Confirm
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
          ))}
        </ul>
      )}
    </div>
  );
}
