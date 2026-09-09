import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const updateListViewModeMock = vi.fn();
const updateDefaultSortMock = vi.fn();
vi.mock("@/lib/actions/preferences", () => ({
  updateListViewMode: (...args: unknown[]) => updateListViewModeMock(...args),
  updateDefaultSort: (...args: unknown[]) => updateDefaultSortMock(...args),
}));

const filterLibraryItemsActionMock = vi.fn();
vi.mock("@/lib/actions/items", () => ({
  filterLibraryItemsAction: (...args: unknown[]) => filterLibraryItemsActionMock(...args),
}));

import { LibraryView } from "./LibraryView";
import type { LibraryItem } from "@/lib/queries/items";
import type { SubtypeOption } from "@/lib/queries/subtypes";
import type { TagOption } from "@/lib/queries/tags";

const CATEGORY_ID = "category-1";

const items: LibraryItem[] = [
  {
    id: "item-1",
    title: "The Witcher 3",
    status: "planned",
    rating: null,
    priority: "high",
    subtypeName: "RPG",
    tags: ["fantasy"],
    coverUrl: null,
  },
  {
    id: "item-2",
    title: "Hades",
    status: "completed",
    rating: 9,
    priority: null,
    subtypeName: "Action",
    tags: [],
    coverUrl: "https://example.com/cover.png",
  },
];

const subtypes: SubtypeOption[] = [
  { id: "subtype-rpg", categoryId: CATEGORY_ID, name: "RPG" },
  { id: "subtype-action", categoryId: CATEGORY_ID, name: "Action" },
  { id: "subtype-other-category", categoryId: "category-2", name: "Fiction" },
];

const tags: TagOption[] = [
  { id: "tag-coop", name: "Coop" },
  { id: "tag-story", name: "Story-rich" },
];

function renderLibraryView(overrides: Partial<ComponentProps<typeof LibraryView>> = {}) {
  return render(
    <LibraryView
      categoryId={CATEGORY_ID}
      categoryName="Games"
      categorySlug="games"
      items={items}
      initialViewMode="list"
      initialSort="recently_added"
      subtypes={subtypes}
      tags={tags}
      {...overrides}
    />,
  );
}

describe("LibraryView", () => {
  afterEach(() => {
    cleanup();
    updateListViewModeMock.mockReset();
    updateDefaultSortMock.mockReset();
    filterLibraryItemsActionMock.mockReset();
    vi.useRealTimers();
  });

  it("always shows the List/Card toggle above the content area, even with zero items", () => {
    renderLibraryView({ items: [] });

    expect(screen.getByRole("group", { name: "View mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Card" })).toBeInTheDocument();
  });

  it('shows the empty state message "No items in {category} yet." and no items, plus an Add item entry point (issue #14) linking to /add', () => {
    renderLibraryView({ items: [] });

    expect(screen.getByText("No items in Games yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add item/i })).toHaveAttribute(
      "href",
      "/add",
    );
  });

  it("renders List view rows by default when initialViewMode is list", () => {
    renderLibraryView();

    const witcherLink = screen.getByRole("link", { name: /The Witcher 3/ });
    expect(witcherLink).toHaveAttribute("href", "/games/item-1");
    // Card view's cover placeholder ("No cover image for...") only renders
    // in Card mode.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders Card view when initialViewMode is card, including cover art and the no-cover placeholder", () => {
    renderLibraryView({ initialViewMode: "card" });

    expect(
      screen.getByRole("img", { name: /no cover image for the witcher 3/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Cover for Hades" })).toBeInTheDocument();
  });

  it("toggling to Card switches the rendered view and persists via updateListViewMode", async () => {
    updateListViewModeMock.mockResolvedValue({ error: null });

    renderLibraryView();

    fireEvent.click(screen.getByRole("button", { name: "Card" }));

    expect(
      screen.getByRole("img", { name: "Cover for Hades" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(updateListViewModeMock).toHaveBeenCalledWith("card"),
    );
  });

  it("does not throw when the persistence write rejects (fire-and-forget)", async () => {
    updateListViewModeMock.mockRejectedValue(new Error("network hiccup"));

    renderLibraryView();

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Card" })),
    ).not.toThrow();

    await waitFor(() => expect(updateListViewModeMock).toHaveBeenCalledTimes(1));
  });

  it("shows the priority badge only for the planned item with a priority, not the completed item", () => {
    renderLibraryView();

    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("omits the rating badge for the item with a null rating and shows it for the rated item", () => {
    renderLibraryView();

    expect(screen.queryByText(/^0\/10$/)).not.toBeInTheDocument();
    expect(screen.getByText("9/10")).toBeInTheDocument();
  });

  it("always shows a search input above the item list, even with zero items", () => {
    renderLibraryView({ items: [] });

    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
  });

  it("always shows the four filter controls plus Clear filters, even with zero items", () => {
    renderLibraryView({ items: [] });

    expect(screen.getByRole("combobox", { name: "Subtype" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rating" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("Subtype options are scoped to this category only, excluding a subtype from another category", () => {
    renderLibraryView();

    const subtypeSelect = screen.getByRole("combobox", { name: "Subtype" }) as HTMLSelectElement;
    const optionLabels = Array.from(subtypeSelect.options).map((option) => option.textContent);

    expect(optionLabels).toEqual(["All subtypes", "RPG", "Action"]);
  });

  it("debounces typing before calling filterLibraryItemsAction, scoped to categoryId, and swaps in the results", async () => {
    vi.useFakeTimers();
    filterLibraryItemsActionMock.mockResolvedValue([items[1]]);

    renderLibraryView();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "hades" },
    });

    // Not called yet -- still inside the debounce window.
    expect(filterLibraryItemsActionMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(filterLibraryItemsActionMock).toHaveBeenCalledWith(
      CATEGORY_ID,
      "hades",
      {
        subtypeId: undefined,
        status: undefined,
        tagIds: undefined,
        minRating: undefined,
      },
      "recently_added",
    );
    expect(screen.queryByRole("link", { name: /The Witcher 3/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Hades/ })).toBeInTheDocument();
  });

  it("clearing the search box immediately restores the full unfiltered list, with no extra call", async () => {
    vi.useFakeTimers();
    filterLibraryItemsActionMock.mockResolvedValue([items[1]]);

    renderLibraryView();

    const searchBox = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(searchBox, { target: { value: "hades" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByRole("link", { name: /Hades/ })).toBeInTheDocument();

    filterLibraryItemsActionMock.mockClear();
    fireEvent.change(searchBox, { target: { value: "   " } });

    expect(screen.getByRole("link", { name: /The Witcher 3/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Hades/ })).toBeInTheDocument();
    expect(filterLibraryItemsActionMock).not.toHaveBeenCalled();
  });

  it('shows a "no matches" message (not the empty-library message) when a search term matches zero items', async () => {
    vi.useFakeTimers();
    filterLibraryItemsActionMock.mockResolvedValue([]);

    renderLibraryView();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "zzzzz" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByText('No items match "zzzzz".')).toBeInTheDocument();
    expect(screen.queryByText("No items in Games yet.")).not.toBeInTheDocument();
  });

  it("selecting a Status filter (with no search term) calls filterLibraryItemsAction with a blank search term and the status set, and swaps in results", async () => {
    vi.useFakeTimers();
    filterLibraryItemsActionMock.mockResolvedValue([items[1]]);

    renderLibraryView();

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "completed" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(filterLibraryItemsActionMock).toHaveBeenCalledWith(
      CATEGORY_ID,
      "",
      {
        subtypeId: undefined,
        status: "completed",
        tagIds: undefined,
        minRating: undefined,
      },
      "recently_added",
    );
    expect(screen.getByRole("link", { name: /Hades/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /The Witcher 3/ })).not.toBeInTheDocument();
  });

  it("selecting multiple tags passes every selected tag id (OR-match is resolved server-side)", async () => {
    vi.useFakeTimers();
    filterLibraryItemsActionMock.mockResolvedValue(items);

    renderLibraryView();

    // The tag checklist lives inside a <details> disclosure, closed by
    // default -- open it (same as a real user clicking the "Tags" trigger)
    // before interacting with the checkboxes inside.
    fireEvent.click(screen.getByText("Tags"));
    fireEvent.click(screen.getByLabelText("Coop"));
    fireEvent.click(screen.getByLabelText("Story-rich"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(filterLibraryItemsActionMock).toHaveBeenCalledWith(
      CATEGORY_ID,
      "",
      expect.objectContaining({ tagIds: expect.arrayContaining(["tag-coop", "tag-story"]) }),
      "recently_added",
    );
    const lastCallTagIds = filterLibraryItemsActionMock.mock.calls.at(-1)![2].tagIds;
    expect(lastCallTagIds).toHaveLength(2);
  });

  it("a rating threshold combines with a search term in one call (AND, not two independent queries)", async () => {
    vi.useFakeTimers();
    filterLibraryItemsActionMock.mockResolvedValue([items[1]]);

    renderLibraryView();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "hades" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Rating" }), {
      target: { value: "8" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // One combined call carrying both the search term and the rating
    // threshold -- not a search call followed by a separate filter call.
    expect(filterLibraryItemsActionMock).toHaveBeenCalledTimes(1);
    expect(filterLibraryItemsActionMock).toHaveBeenCalledWith(
      CATEGORY_ID,
      "hades",
      {
        subtypeId: undefined,
        status: undefined,
        tagIds: undefined,
        minRating: 8,
      },
      "recently_added",
    );
  });

  it('shows "No items match the selected filters." (not the search or empty-library message) when a filter-only combination matches zero items', async () => {
    vi.useFakeTimers();
    filterLibraryItemsActionMock.mockResolvedValue([]);

    renderLibraryView();

    fireEvent.change(screen.getByRole("combobox", { name: "Rating" }), {
      target: { value: "10" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByText("No items match the selected filters.")).toBeInTheDocument();
    expect(screen.queryByText("No items in Games yet.")).not.toBeInTheDocument();
    expect(screen.queryByText(/^No items match "/)).not.toBeInTheDocument();
  });

  it("Clear filters resets Subtype/Status/Tags/Rating in one action and restores the full unfiltered list", async () => {
    vi.useFakeTimers();
    filterLibraryItemsActionMock.mockResolvedValue([items[1]]);

    renderLibraryView();

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "completed" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByRole("link", { name: /Hades/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /The Witcher 3/ })).not.toBeInTheDocument();

    filterLibraryItemsActionMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("");
    expect(screen.getByRole("link", { name: /The Witcher 3/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Hades/ })).toBeInTheDocument();
    expect(filterLibraryItemsActionMock).not.toHaveBeenCalled();
  });

  // Sort control (issue #24).
  it("always shows the Sort control with exactly three options, defaulting to initialSort", () => {
    renderLibraryView({ items: [], initialSort: "priority" });

    const sortSelect = screen.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement;
    const optionLabels = Array.from(sortSelect.options).map((option) => option.textContent);

    expect(optionLabels).toEqual(["Recently Added", "Priority", "Status"]);
    expect(sortSelect).toHaveValue("priority");
  });

  it("selecting Priority calls filterLibraryItemsAction with the chosen sort, swaps in results, and persists via updateDefaultSort", async () => {
    vi.useFakeTimers();
    updateDefaultSortMock.mockResolvedValue({ error: null });
    filterLibraryItemsActionMock.mockResolvedValue([items[1], items[0]]);

    renderLibraryView();

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "priority" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(filterLibraryItemsActionMock).toHaveBeenCalledWith(
      CATEGORY_ID,
      "",
      {
        subtypeId: undefined,
        status: undefined,
        tagIds: undefined,
        minRating: undefined,
      },
      "priority",
    );
    expect(updateDefaultSortMock).toHaveBeenCalledWith("priority");
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("priority");
  });

  it("does not throw when the sort persistence write rejects (fire-and-forget)", async () => {
    updateDefaultSortMock.mockRejectedValue(new Error("network hiccup"));
    filterLibraryItemsActionMock.mockResolvedValue(items);

    renderLibraryView();

    expect(() =>
      fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
        target: { value: "status" },
      }),
    ).not.toThrow();

    await waitFor(() => expect(updateDefaultSortMock).toHaveBeenCalledTimes(1));
  });

  it("changing sort combines with an active filter in one call, rather than dropping the filter", async () => {
    vi.useFakeTimers();
    updateDefaultSortMock.mockResolvedValue({ error: null });
    filterLibraryItemsActionMock.mockResolvedValue([items[1]]);

    renderLibraryView();

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "completed" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    filterLibraryItemsActionMock.mockClear();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "status" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(filterLibraryItemsActionMock).toHaveBeenCalledTimes(1);
    expect(filterLibraryItemsActionMock).toHaveBeenCalledWith(
      CATEGORY_ID,
      "",
      {
        subtypeId: undefined,
        status: "completed",
        tagIds: undefined,
        minRating: undefined,
      },
      "status",
    );
  });

  it("Clear filters does not reset the current sort selection", async () => {
    vi.useFakeTimers();
    updateDefaultSortMock.mockResolvedValue({ error: null });
    filterLibraryItemsActionMock.mockResolvedValue(items);

    renderLibraryView();

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "status" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("status");
  });

  it("selecting sort back to its initial value (with no other active query) restores the server-provided items with no further round trip", async () => {
    vi.useFakeTimers();
    updateDefaultSortMock.mockResolvedValue({ error: null });
    filterLibraryItemsActionMock.mockResolvedValue([items[1]]);

    renderLibraryView();

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "priority" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.queryByRole("link", { name: /The Witcher 3/ })).not.toBeInTheDocument();

    filterLibraryItemsActionMock.mockClear();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "recently_added" },
    });

    expect(screen.getByRole("link", { name: /The Witcher 3/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Hades/ })).toBeInTheDocument();
    expect(filterLibraryItemsActionMock).not.toHaveBeenCalled();
  });
});
