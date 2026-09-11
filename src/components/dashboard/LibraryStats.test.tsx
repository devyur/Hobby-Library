import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// Unit coverage for LibraryStats.tsx's issue #50 additions: the new
// showCategoryBreakdown prop (default true, so the existing account-wide
// /dashboard call site is unaffected with no prop change needed) and
// CategoryBreakdownList rows becoming real links to /dashboard/[slug]. Every
// other stat-rendering behavior (issue #27) already has e2e coverage
// (e2e/dashboard.spec.ts) against the live app; this suite only isolates the
// new prop-driven branching, which doesn't need a live database.

import { LibraryStats } from "./LibraryStats";
import type { DashboardStats } from "@/lib/queries/dashboard";

function makeStats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    totalItems: 3,
    statusCounts: { planned: 1, ongoing: 1, completed: 1, dropped: 0 },
    averageRating: 8,
    recentItems: [],
    completionRatePercent: 100,
    ratingDistribution: new Array(10).fill(0),
    categoryBreakdown: [
      { categoryId: "cat-games", categoryName: "Games", categorySlug: "games", count: 2 },
      { categoryId: "cat-books", categoryName: "Books", categorySlug: "books", count: 1 },
    ],
    ...overrides,
  };
}

describe("LibraryStats", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the Category breakdown section by default (no prop passed), unaffected by issue #50", () => {
    render(<LibraryStats stats={makeStats()} />);

    expect(screen.getByText("Category breakdown")).toBeInTheDocument();
    expect(screen.getByText("Rating distribution")).toBeInTheDocument();
  });

  it("omits the Category breakdown grid cell entirely when showCategoryBreakdown is false, but still renders Rating distribution", () => {
    render(<LibraryStats stats={makeStats()} showCategoryBreakdown={false} />);

    expect(screen.queryByText("Category breakdown")).not.toBeInTheDocument();
    expect(screen.getByText("Rating distribution")).toBeInTheDocument();
  });

  it("links each Category breakdown row to /dashboard/[slug] for that category (a real <a>, not a JS-only handler)", () => {
    render(<LibraryStats stats={makeStats()} />);

    const gamesRow = screen.getByLabelText("Games: 2 items");
    const gamesLink = gamesRow.querySelector("a");
    expect(gamesLink).toHaveAttribute("href", "/dashboard/games");

    const booksRow = screen.getByLabelText("Books: 1 items");
    const booksLink = booksRow.querySelector("a");
    expect(booksLink).toHaveAttribute("href", "/dashboard/books");
  });
});
