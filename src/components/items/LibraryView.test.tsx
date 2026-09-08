import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const updateListViewModeMock = vi.fn();
vi.mock("@/lib/actions/preferences", () => ({
  updateListViewMode: (...args: unknown[]) => updateListViewModeMock(...args),
}));

import { LibraryView } from "./LibraryView";
import type { LibraryItem } from "@/lib/queries/items";

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

describe("LibraryView", () => {
  afterEach(() => {
    cleanup();
    updateListViewModeMock.mockReset();
  });

  it("always shows the List/Card toggle above the content area, even with zero items", () => {
    render(
      <LibraryView
        categoryName="Games"
        categorySlug="games"
        items={[]}
        initialViewMode="list"
      />,
    );

    expect(screen.getByRole("group", { name: "View mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Card" })).toBeInTheDocument();
  });

  it('shows the empty state message "No items in {category} yet." and no items, and no Add CTA', () => {
    render(
      <LibraryView
        categoryName="Games"
        categorySlug="games"
        items={[]}
        initialViewMode="list"
      />,
    );

    expect(screen.getByText("No items in Games yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add item/i }),
    ).not.toBeInTheDocument();
  });

  it("renders List view rows by default when initialViewMode is list", () => {
    render(
      <LibraryView
        categoryName="Games"
        categorySlug="games"
        items={items}
        initialViewMode="list"
      />,
    );

    const witcherLink = screen.getByRole("link", { name: /The Witcher 3/ });
    expect(witcherLink).toHaveAttribute("href", "/games/item-1");
    // Card view's cover placeholder ("No cover image for...") only renders
    // in Card mode.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders Card view when initialViewMode is card, including cover art and the no-cover placeholder", () => {
    render(
      <LibraryView
        categoryName="Games"
        categorySlug="games"
        items={items}
        initialViewMode="card"
      />,
    );

    expect(
      screen.getByRole("img", { name: /no cover image for the witcher 3/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Cover for Hades" })).toBeInTheDocument();
  });

  it("toggling to Card switches the rendered view and persists via updateListViewMode", async () => {
    updateListViewModeMock.mockResolvedValue({ error: null });

    render(
      <LibraryView
        categoryName="Games"
        categorySlug="games"
        items={items}
        initialViewMode="list"
      />,
    );

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

    render(
      <LibraryView
        categoryName="Games"
        categorySlug="games"
        items={items}
        initialViewMode="list"
      />,
    );

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Card" })),
    ).not.toThrow();

    await waitFor(() => expect(updateListViewModeMock).toHaveBeenCalledTimes(1));
  });

  it("shows the priority badge only for the planned item with a priority, not the completed item", () => {
    render(
      <LibraryView
        categoryName="Games"
        categorySlug="games"
        items={items}
        initialViewMode="list"
      />,
    );

    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("omits the rating badge for the item with a null rating and shows it for the rated item", () => {
    render(
      <LibraryView
        categoryName="Games"
        categorySlug="games"
        items={items}
        initialViewMode="list"
      />,
    );

    expect(screen.queryByText(/^0\/10$/)).not.toBeInTheDocument();
    expect(screen.getByText("9/10")).toBeInTheDocument();
  });
});
