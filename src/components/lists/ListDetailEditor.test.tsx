import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const addItemToListActionMock = vi.fn();
const removeItemFromListActionMock = vi.fn();
const reorderListItemsActionMock = vi.fn();
vi.mock("@/lib/actions/lists", () => ({
  addItemToListAction: (...args: unknown[]) => addItemToListActionMock(...args),
  removeItemFromListAction: (...args: unknown[]) => removeItemFromListActionMock(...args),
  reorderListItemsAction: (...args: unknown[]) => reorderListItemsActionMock(...args),
}));

import { ListDetailEditor } from "./ListDetailEditor";
import type { AddableItem, ListMemberItem } from "@/lib/queries/lists";

// Component coverage for lists/[listId]'s member-item editor (issue #26,
// extended by #42's drag/keyboard reordering). Add/Remove assertions mirror
// ItemLinksEditor.test.tsx's shape (each is its own immediate Server Action
// call, optimistic-update-then-rollback-on-error). Reorder is exercised via
// the keyboard path only -- @dnd-kit's PointerSensor depends on real
// pointer-capture/geometry behavior jsdom doesn't implement, but its
// KeyboardSensor is plain keydown events on the drag handle (Space/Enter to
// pick up, arrow keys to move, Space/Enter to drop), which is both testable
// here AND is the literal mechanism the "keyboard-only reordering" -- and
// "drag handle... equivalent grab control" -- acceptance criteria describe.
// The live pointer-drag + full-reload-persists-order flow is covered by
// e2e/lists.spec.ts instead.
//
// @dnd-kit/core measures each draggable/droppable node via ResizeObserver,
// which jsdom doesn't implement (as of the jsdom version this project
// pins) -- stubbed globally here, scoped to this file only, rather than in
// the shared vitest.setup.ts, since no other component in this codebase
// needs it.
//
// jsdom's getBoundingClientRect always returns an all-zero rect, which
// leaves every row measuring as the same 0x0 box at (0,0) -- dnd-kit's
// keyboard coordinate getter (sortableKeyboardCoordinates) picks the "next"
// row by comparing rect.top values, so with every rect identical it can
// never find one. Stubbed to a simple fixed-height vertical stack, keyed off
// each row <li>'s position among its siblings, purely so that comparison has
// something real to work with -- this is a layout fake for the test
// environment only, not a real measurement.
beforeAll(() => {
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);

  const ROW_HEIGHT = 60;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const parent = this.parentElement;
    const index = parent ? Array.prototype.indexOf.call(parent.children, this) : 0;
    const top = index * ROW_HEIGHT;
    return {
      width: 300,
      height: ROW_HEIGHT,
      top,
      bottom: top + ROW_HEIGHT,
      left: 0,
      right: 300,
      x: 0,
      y: top,
      toJSON() {
        return {};
      },
    } as DOMRect;
  });
});

function member(overrides: Partial<ListMemberItem> = {}): ListMemberItem {
  return {
    id: "item-1",
    title: "Chrono Trigger",
    categorySlug: "games",
    categoryName: "Games",
    subtypeName: "RPG",
    coverUrl: null,
    ...overrides,
  };
}

function addable(overrides: Partial<AddableItem> = {}): AddableItem {
  return {
    id: "item-2",
    title: "Dune",
    categorySlug: "books",
    categoryName: "Books",
    subtypeName: "Fiction",
    ...overrides,
  };
}

function renderEditor(initialItems: ListMemberItem[] = [], initialAddableItems: AddableItem[] = []) {
  return render(
    <ListDetailEditor
      listId="list-1"
      initialItems={initialItems}
      initialAddableItems={initialAddableItems}
    />,
  );
}

describe("ListDetailEditor", () => {
  afterEach(() => {
    cleanup();
    addItemToListActionMock.mockReset();
    removeItemFromListActionMock.mockReset();
    reorderListItemsActionMock.mockReset();
  });

  it("renders the empty state and no drag handle when the list has zero items", () => {
    renderEditor([]);

    expect(screen.getByText("This list has no items yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /drag to reorder/i })).not.toBeInTheDocument();
  });

  it("renders a single member with no drag handle -- nothing to reorder", () => {
    renderEditor([member()]);

    expect(screen.getByText("Chrono Trigger")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /drag to reorder/i })).not.toBeInTheDocument();
  });

  it("renders a drag handle on every row once the list has 2+ members", () => {
    renderEditor([member({ id: "item-1", title: "Chrono Trigger" }), member({ id: "item-2", title: "Dune" })]);

    expect(screen.getByRole("button", { name: "Drag to reorder Chrono Trigger" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drag to reorder Dune" })).toBeInTheDocument();
  });

  it("adding an item calls addItemToListAction and appends the new item to the END of the member list", async () => {
    addItemToListActionMock.mockResolvedValue({ success: true });

    renderEditor([member({ id: "item-1", title: "Chrono Trigger" })], [addable()]);

    fireEvent.change(screen.getByLabelText("Item"), { target: { value: "item-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to list" }));

    await waitFor(() => expect(addItemToListActionMock).toHaveBeenCalledWith("list-1", "item-2"));
    await waitFor(() => expect(screen.getByText("Dune")).toBeInTheDocument());

    const rows = screen.getAllByRole("listitem");
    const titles = rows.map((row) => row.textContent);
    expect(titles[0]).toContain("Chrono Trigger");
    expect(titles[1]).toContain("Dune");
  });

  it("removing one item calls removeItemFromListAction for only that item, and leaves the remaining items' order untouched", async () => {
    removeItemFromListActionMock.mockResolvedValue({ success: true });

    renderEditor([
      member({ id: "item-1", title: "Chrono Trigger" }),
      member({ id: "item-2", title: "Dune" }),
      member({ id: "item-3", title: "Persona 5" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Dune" }));

    await waitFor(() => expect(removeItemFromListActionMock).toHaveBeenCalledWith("list-1", "item-2"));
    await waitFor(() => expect(screen.queryByText("Dune")).not.toBeInTheDocument());

    const rows = screen.getAllByRole("listitem");
    const titles = rows.map((row) => row.textContent);
    expect(titles[0]).toContain("Chrono Trigger");
    expect(titles[1]).toContain("Persona 5");
  });

  it("rolls back the optimistic removal and shows an error if remove fails server-side", async () => {
    removeItemFromListActionMock.mockResolvedValue({
      error: "Failed to remove item from list. Please try again.",
    });

    renderEditor([member({ id: "item-1", title: "Chrono Trigger" })]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Chrono Trigger" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Chrono Trigger")).toBeInTheDocument();
  });

  it("keyboard-reordering a row moves it immediately (no flicker back) and saves the whole new order in one call", async () => {
    reorderListItemsActionMock.mockResolvedValue({ success: true });

    renderEditor([
      member({ id: "item-1", title: "Chrono Trigger" }),
      member({ id: "item-2", title: "Dune" }),
      member({ id: "item-3", title: "Persona 5" }),
    ]);

    const handle = screen.getByRole("button", { name: "Drag to reorder Chrono Trigger" });
    handle.focus();
    // dnd-kit's KeyboardSensor: Space picks up, ArrowDown moves one slot,
    // Space drops. Picking up attaches the sensor's follow-up keydown
    // listener via a bare setTimeout(0) (KeyboardSensor.attach(), dnd-kit's
    // own source) -- awaiting a tick between pickup and the move/drop
    // keystrokes lets that listener actually attach before they fire,
    // matching how a real (non-zero-latency) keypress sequence would land.
    fireEvent.keyDown(handle, { code: "Space" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.keyDown(handle, { code: "ArrowDown" });
    fireEvent.keyDown(handle, { code: "Space" });

    // Immediate on-screen reorder -- Chrono Trigger moves past Dune to
    // second position, before the Server Action call resolves.
    const rowsAfterDrag = screen.getAllByRole("listitem");
    expect(rowsAfterDrag[0].textContent).toContain("Dune");
    expect(rowsAfterDrag[1].textContent).toContain("Chrono Trigger");

    await waitFor(() =>
      expect(reorderListItemsActionMock).toHaveBeenCalledWith("list-1", [
        "item-2",
        "item-1",
        "item-3",
      ]),
    );
    expect(reorderListItemsActionMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back to the pre-drag order and shows an error if the reorder save fails server-side", async () => {
    reorderListItemsActionMock.mockResolvedValue({
      error: "Failed to save the new order. Please try again.",
    });

    renderEditor([
      member({ id: "item-1", title: "Chrono Trigger" }),
      member({ id: "item-2", title: "Dune" }),
    ]);

    const handle = screen.getByRole("button", { name: "Drag to reorder Chrono Trigger" });
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.keyDown(handle, { code: "ArrowDown" });
    fireEvent.keyDown(handle, { code: "Space" });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("Chrono Trigger");
    expect(rows[1].textContent).toContain("Dune");
  });

  it("disables drag handles and Remove buttons while a save is in flight", async () => {
    let resolveRemove: (value: { success: true }) => void = () => {};
    removeItemFromListActionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRemove = resolve;
      }),
    );

    // Three members, not two -- removing one still leaves 2+ members
    // behind, so the drag handles stay mounted (a 0/1-item list renders no
    // drag handle at all, which would otherwise make this assertion
    // meaningless).
    renderEditor([
      member({ id: "item-1", title: "Chrono Trigger" }),
      member({ id: "item-2", title: "Dune" }),
      member({ id: "item-3", title: "Persona 5" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Chrono Trigger" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Drag to reorder Dune" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Remove Dune" })).toBeDisabled();

    resolveRemove({ success: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Drag to reorder Dune" })).not.toBeDisabled(),
    );
  });
});
