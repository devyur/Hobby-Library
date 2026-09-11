import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const addItemToListActionMock = vi.fn();
const removeItemFromListActionMock = vi.fn();
vi.mock("@/lib/actions/lists", () => ({
  addItemToListAction: (...args: unknown[]) => addItemToListActionMock(...args),
  removeItemFromListAction: (...args: unknown[]) => removeItemFromListActionMock(...args),
}));

import { ItemListsEditor } from "./ItemListsEditor";
import type { ListMembership } from "@/lib/queries/lists";

// Component coverage for the always-interactive Lists shortcut (issue #41),
// same shape as ItemLinksEditor.test.tsx (#20)/ItemTagsEditor.test.tsx
// (#17): each check/uncheck asserted as its own immediate Server Action
// call against only the toggled list, plus the optimistic-then-rollback
// error path. The live end-to-end flow (real DB round trip) is left to the
// existing e2e/lists.spec.ts coverage.

function renderEditor(initialLists: ListMembership[] = []) {
  return render(<ItemListsEditor itemId="item-1" initialLists={initialLists} />);
}

describe("ItemListsEditor", () => {
  afterEach(() => {
    cleanup();
    addItemToListActionMock.mockReset();
    removeItemFromListActionMock.mockReset();
  });

  it("renders the empty state with a link to /lists when the user owns zero lists", () => {
    renderEditor([]);

    expect(screen.getByRole("heading", { name: "Lists" })).toBeInTheDocument();
    expect(screen.getByText(/You don't have any lists yet\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create one" })).toHaveAttribute("href", "/lists");
  });

  it("renders one checkbox per owned list, checked only for lists the item already belongs to", () => {
    renderEditor([
      { id: "list-1", name: "Play next", isMember: true },
      { id: "list-2", name: "Best games", isMember: false },
    ]);

    expect(screen.getByRole("checkbox", { name: "Play next" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Best games" })).not.toBeChecked();
  });

  it("checking an unchecked list calls addItemToListAction for only that list and shows it checked", async () => {
    addItemToListActionMock.mockResolvedValue({ success: true });

    renderEditor([
      { id: "list-1", name: "Play next", isMember: false },
      { id: "list-2", name: "Best games", isMember: false },
    ]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Play next" }));

    await waitFor(() =>
      expect(addItemToListActionMock).toHaveBeenCalledWith("list-1", "item-1"),
    );
    expect(addItemToListActionMock).toHaveBeenCalledTimes(1);
    expect(removeItemFromListActionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Play next" })).toBeChecked();
    // The other list is untouched.
    expect(screen.getByRole("checkbox", { name: "Best games" })).not.toBeChecked();
  });

  it("unchecking a checked list calls removeItemFromListAction for only that list and shows it unchecked", async () => {
    removeItemFromListActionMock.mockResolvedValue({ success: true });

    renderEditor([{ id: "list-1", name: "Play next", isMember: true }]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Play next" }));

    await waitFor(() =>
      expect(removeItemFromListActionMock).toHaveBeenCalledWith("list-1", "item-1"),
    );
    expect(screen.getByRole("checkbox", { name: "Play next" })).not.toBeChecked();
  });

  it("toggling several lists in the same visit keeps each change independent", async () => {
    addItemToListActionMock.mockResolvedValue({ success: true });
    removeItemFromListActionMock.mockResolvedValue({ success: true });

    renderEditor([
      { id: "list-1", name: "Play next", isMember: false },
      { id: "list-2", name: "Best games", isMember: true },
      { id: "list-3", name: "Backlog", isMember: false },
    ]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Play next" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Best games" }));

    await waitFor(() =>
      expect(addItemToListActionMock).toHaveBeenCalledWith("list-1", "item-1"),
    );
    await waitFor(() =>
      expect(removeItemFromListActionMock).toHaveBeenCalledWith("list-2", "item-1"),
    );

    expect(screen.getByRole("checkbox", { name: "Play next" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Best games" })).not.toBeChecked();
    // Never touched -- neither its checked state nor either action.
    expect(screen.getByRole("checkbox", { name: "Backlog" })).not.toBeChecked();
  });

  it("rolls back an optimistic check and shows an error if the add fails server-side", async () => {
    addItemToListActionMock.mockResolvedValue({ error: "Failed to add item to list. Please try again." });

    renderEditor([
      { id: "list-1", name: "Play next", isMember: false },
      { id: "list-2", name: "Best games", isMember: false },
    ]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Play next" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Play next" })).not.toBeChecked();
    // The other list is untouched by the rollback.
    expect(screen.getByRole("checkbox", { name: "Best games" })).not.toBeChecked();
  });

  it("rolls back an optimistic uncheck and shows an error if the remove fails server-side", async () => {
    removeItemFromListActionMock.mockResolvedValue({
      error: "Failed to remove item from list. Please try again.",
    });

    renderEditor([{ id: "list-1", name: "Play next", isMember: true }]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Play next" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Play next" })).toBeChecked();
  });
});
