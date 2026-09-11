import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Client-interactivity coverage for RecommendationsPanel (issue #44) -- the
// Client Component RecommendationsSection.tsx now hands its server-fetched
// RecommendationsData to. Mocks the three Server Actions the same way
// LibraryView.test.tsx mocks lib/actions/items.ts/preferences.ts: this
// suite drives the client-side state machine (dismiss/undo/shuffle/
// empty-state) in isolation from the real database.

const dismissRecommendationActionMock = vi.fn();
const undismissRecommendationActionMock = vi.fn();
const rerollRandomPlannedActionMock = vi.fn();
vi.mock("@/lib/actions/recommendations", () => ({
  dismissRecommendationAction: (...args: unknown[]) => dismissRecommendationActionMock(...args),
  undismissRecommendationAction: (...args: unknown[]) => undismissRecommendationActionMock(...args),
  rerollRandomPlannedAction: (...args: unknown[]) => rerollRandomPlannedActionMock(...args),
}));

import { RecommendationsPanel } from "./RecommendationsPanel";
import type { RecommendationItem, RecommendationsData } from "@/lib/queries/dashboard";

function makeItem(overrides: Partial<RecommendationItem> & { id: string }): RecommendationItem {
  return {
    title: `Item ${overrides.id}`,
    categorySlug: "books",
    categoryName: "Books",
    status: "planned",
    rating: null,
    priority: null,
    subtypeName: "Fiction",
    tags: [],
    coverUrl: null,
    ...overrides,
  };
}

function emptyData(): RecommendationsData {
  return { recommendedPlanned: [], randomPlanned: null, continueOngoing: [] };
}

describe("RecommendationsPanel", () => {
  afterEach(() => {
    cleanup();
    dismissRecommendationActionMock.mockReset();
    undismissRecommendationActionMock.mockReset();
    rerollRandomPlannedActionMock.mockReset();
  });

  it("shows the default empty-state message when every group starts empty (never dismissed anything)", () => {
    render(<RecommendationsPanel initialData={emptyData()} />);

    expect(
      screen.getByText(
        "No recommendations yet — add a few items to your library to see suggestions here.",
      ),
    ).toBeInTheDocument();
  });

  it("renders Recommended Planned/Random pick/Continue groups, and only shows Shuffle alongside Random pick", () => {
    const data: RecommendationsData = {
      recommendedPlanned: [makeItem({ id: "rp-1" })],
      randomPlanned: makeItem({ id: "random-1" }),
      continueOngoing: [makeItem({ id: "co-1" })],
    };
    render(<RecommendationsPanel initialData={data} />);

    expect(screen.getByLabelText("Recommended Planned")).toBeInTheDocument();
    expect(screen.getByLabelText("Random pick")).toBeInTheDocument();
    expect(screen.getByLabelText("Continue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeInTheDocument();
  });

  it("dismissing a Recommended Planned card persists the dismiss and removes it from view immediately", async () => {
    dismissRecommendationActionMock.mockResolvedValue({ success: true });
    const data: RecommendationsData = {
      recommendedPlanned: [makeItem({ id: "rp-1", title: "Dune" })],
      randomPlanned: null,
      continueOngoing: [],
    };
    render(<RecommendationsPanel initialData={data} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss Dune" }));
    });

    expect(dismissRecommendationActionMock).toHaveBeenCalledWith("rp-1");
    await waitFor(() => expect(screen.queryByText("Dune")).not.toBeInTheDocument());
  });

  it("offers an immediate Undo after a dismiss, which restores the item and un-dismisses it server-side", async () => {
    dismissRecommendationActionMock.mockResolvedValue({ success: true });
    undismissRecommendationActionMock.mockResolvedValue({ success: true });
    const data: RecommendationsData = {
      recommendedPlanned: [makeItem({ id: "rp-1", title: "Dune" })],
      randomPlanned: null,
      continueOngoing: [],
    };
    render(<RecommendationsPanel initialData={data} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss Dune" }));
    });
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });

    expect(undismissRecommendationActionMock).toHaveBeenCalledWith("rp-1");
    await waitFor(() => expect(screen.getByText("Dune")).toBeInTheDocument());
  });

  it("dismissing the Random pick's item immediately fetches and shows a replacement instead of leaving the group empty", async () => {
    dismissRecommendationActionMock.mockResolvedValue({ success: true });
    rerollRandomPlannedActionMock.mockResolvedValue(makeItem({ id: "random-2", title: "New Pick" }));
    const data: RecommendationsData = {
      recommendedPlanned: [],
      randomPlanned: makeItem({ id: "random-1", title: "Old Pick" }),
      continueOngoing: [],
    };
    render(<RecommendationsPanel initialData={data} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss Old Pick" }));
    });

    expect(dismissRecommendationActionMock).toHaveBeenCalledWith("random-1");
    expect(rerollRandomPlannedActionMock).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("New Pick")).toBeInTheDocument());
    expect(screen.queryByText("Old Pick")).not.toBeInTheDocument();
  });

  it("Shuffle replaces the displayed Random pick item without touching other groups", async () => {
    rerollRandomPlannedActionMock.mockResolvedValue(makeItem({ id: "random-2", title: "Shuffled" }));
    const data: RecommendationsData = {
      recommendedPlanned: [makeItem({ id: "rp-1", title: "Stays Put" })],
      randomPlanned: makeItem({ id: "random-1", title: "Original" }),
      continueOngoing: [],
    };
    render(<RecommendationsPanel initialData={data} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    });

    expect(rerollRandomPlannedActionMock).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Shuffled")).toBeInTheDocument());
    expect(screen.queryByText("Original")).not.toBeInTheDocument();
    expect(screen.getByText("Stays Put")).toBeInTheDocument();
  });

  it("Shuffle is allowed to return the same item again (no distinctness guarantee)", async () => {
    const sameItem = makeItem({ id: "random-1", title: "Original" });
    rerollRandomPlannedActionMock.mockResolvedValue(sameItem);
    const data: RecommendationsData = {
      recommendedPlanned: [],
      randomPlanned: sameItem,
      continueOngoing: [],
    };
    render(<RecommendationsPanel initialData={data} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    });

    await waitFor(() => expect(rerollRandomPlannedActionMock).toHaveBeenCalled());
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("shows the distinct dismissed-empty message (not the add-items message) once a dismiss empties every group", async () => {
    dismissRecommendationActionMock.mockResolvedValue({ success: true });
    const data: RecommendationsData = {
      recommendedPlanned: [makeItem({ id: "rp-1", title: "Only Item" })],
      randomPlanned: null,
      continueOngoing: [],
    };
    render(<RecommendationsPanel initialData={data} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss Only Item" }));
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          "No recommendations left — you've dismissed everything currently eligible. Add or update items, or check back later for new picks.",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(
        "No recommendations yet — add a few items to your library to see suggestions here.",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows an error and leaves the item visible when the dismiss action fails", async () => {
    dismissRecommendationActionMock.mockResolvedValue({ error: "Failed to dismiss this recommendation. Please try again." });
    const data: RecommendationsData = {
      recommendedPlanned: [makeItem({ id: "rp-1", title: "Dune" })],
      randomPlanned: null,
      continueOngoing: [],
    };
    render(<RecommendationsPanel initialData={data} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss Dune" }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to dismiss this recommendation. Please try again.",
    );
    expect(screen.getByText("Dune")).toBeInTheDocument();
  });
});
