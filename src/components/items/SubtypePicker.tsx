"use client";

import { useState, useTransition } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createSubtypeAction } from "@/lib/actions/subtypes";
import { subtypeNameSchema } from "@/lib/validation/subtypes";

export interface SubtypeChoice {
  id: string;
  name: string;
}

// Sentinel <option value>, never a real subtype id (those are uuids) --
// selecting it opens the inline "create new subtype" input rather than
// setting a real subtypeId.
const CREATE_NEW_VALUE = "__create_new_subtype__";

// Shared Subtype control (issue #18): a plain <select> plus a "+ Create new
// subtype…" affordance, used by both the Full Add form (AddItemForm.tsx,
// #14 -- replacing its plain <Select name="subtypeId">) and the item detail
// page's edit form (ItemEditForm.tsx -- #16 left Subtype out of the edit
// surface entirely; this issue adds the first control for it). Always
// renders `<select name="subtypeId">`, so it's a drop-in replacement
// wherever the field name "subtypeId" was already expected by
// addItemSchema/editItemSchema.
//
// Creation itself goes through createSubtypeAction (lib/actions/subtypes.ts)
// -- a create-or-find scoped to `categoryId`, same case-insensitive trimmed
// dedup pattern as ItemTagsEditor's typed-tag path. Unlike tags, there's no
// "attach" step: a subtype is a single FK, not a join-table relation, so a
// successful create/find just updates this picker's own selection --
// `onCreated` lets the parent append the new row to its own subtype pool
// (so retyping the same name later suggests/selects it instead of
// re-creating), and `onChange` selects it immediately, matching
// tasks.md's "newly created subtypes should immediately appear as
// selectable" with no page reload.
export function SubtypePicker({
  id,
  categoryId,
  value,
  options,
  onChange,
  onCreated,
  disabled,
  ariaInvalid,
  ariaDescribedBy,
}: {
  id: string;
  categoryId: string;
  value: string;
  options: SubtypeChoice[];
  onChange: (subtypeId: string) => void;
  onCreated: (subtype: SubtypeChoice) => void;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSelectChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (next === CREATE_NEW_VALUE) {
      setIsCreating(true);
      setError(null);
      return;
    }
    onChange(next);
  }

  function handleCancelCreate() {
    setIsCreating(false);
    setName("");
    setError(null);
  }

  function handleCreate() {
    // Client-side rejection of empty/whitespace-only input, mirroring the
    // server-side subtypeNameSchema re-check in createSubtypeAction.
    const parsed = subtypeNameSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a subtype name");
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await createSubtypeAction(categoryId, parsed.data.name);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onCreated(result.subtype);
      onChange(result.subtype.id);
      setIsCreating(false);
      setName("");
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreate();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        id={id}
        name="subtypeId"
        value={isCreating ? CREATE_NEW_VALUE : value}
        onChange={handleSelectChange}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      >
        <option value="">
          {categoryId ? "Select a subtype…" : "Select a category first"}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
        <option value={CREATE_NEW_VALUE}>+ Create new subtype…</option>
      </Select>

      {isCreating ? (
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="New subtype name"
            aria-label="New subtype name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isPending}
            autoFocus
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCreate}
            disabled={isPending || name.trim() === ""}
          >
            Create
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancelCreate}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
