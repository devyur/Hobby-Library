import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const updateNotesActionMock = vi.fn();
const updateReviewActionMock = vi.fn();
const markItemCompletedActionMock = vi.fn();
vi.mock("@/lib/actions/items", () => ({
  updateNotesAction: (...args: unknown[]) => updateNotesActionMock(...args),
  updateReviewAction: (...args: unknown[]) => updateReviewActionMock(...args),
  markItemCompletedAction: (...args: unknown[]) => markItemCompletedActionMock(...args),
}));

import { NotesReview } from "./NotesReview";

// Component coverage for the always-interactive Notes/Review editors (issue
// #48 -- mirrors ItemTagsEditor.test.tsx's own style for #17). Each save is
// asserted as its own immediate Server Action call, never batched with the
// other field or gated behind any shared form submit. The live end-to-end
// flow (a real DB round trip, the main Edit/Save form staying open
// alongside these) is covered by e2e coverage instead.
describe("NotesReview", () => {
  afterEach(() => {
    cleanup();
    updateNotesActionMock.mockReset();
    updateReviewActionMock.mockReset();
    markItemCompletedActionMock.mockReset();
  });

  it("shows an 'Add a note'/'Add a review' button, not blank space, when both are empty", () => {
    render(<NotesReview itemId="item-1" notes={null} review={null} />);

    expect(screen.getByRole("button", { name: "Add a note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a review" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders populated Notes/Review with their distinct visual treatments and an Edit control for each", () => {
    render(<NotesReview itemId="item-1" notes="Some notes" review="Some review" />);

    expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();

    const notesBlock = screen.getByText("Some notes");
    const reviewBlock = screen.getByText("Some review");
    expect(notesBlock.className).not.toBe(reviewBlock.className);
    expect(notesBlock.className).toContain("bg-surface");
    expect(reviewBlock.className).toContain("bg-bg");
    expect(reviewBlock.className).toContain("italic");

    // Distinctly-named Edit controls (not both just "Edit") -- unambiguous
    // from each other and from the main Edit/Save form's own "Edit" button.
    expect(screen.getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit review" })).toBeInTheDocument();
  });

  it("clicking 'Add a note' expands a focusable textarea with Save/Cancel, not a click-anywhere affordance", () => {
    render(<NotesReview itemId="item-1" notes={null} review={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));

    expect(screen.getByRole("textbox", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("saving a note calls updateNotesAction independently, without touching Review", async () => {
    updateNotesActionMock.mockResolvedValue({ notes: "New note" });

    render(<NotesReview itemId="item-1" notes={null} review={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "New note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateNotesActionMock).toHaveBeenCalledWith("item-1", "New note"));
    expect(updateReviewActionMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("New note")).toBeInTheDocument());
    // Collapses back to the display treatment, not left expanded.
    expect(screen.queryByRole("textbox", { name: "Notes" })).not.toBeInTheDocument();
  });

  it("Cancel discards the draft without saving and reverts to the prior value", () => {
    render(<NotesReview itemId="item-1" notes="Original" review={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "Discarded draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(updateNotesActionMock).not.toHaveBeenCalled();
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("shows an inline error and stays expanded when saving a note fails", async () => {
    updateNotesActionMock.mockResolvedValue({ error: "Failed to save notes. Please try again." });

    render(<NotesReview itemId="item-1" notes={null} review={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "New note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeInTheDocument();
  });

  it("saving a note never shows the Completed nudge, in either direction", async () => {
    updateNotesActionMock.mockResolvedValue({ notes: "New note" });

    render(<NotesReview itemId="item-1" notes={null} review={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "New note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("New note")).toBeInTheDocument());
    expect(screen.queryByText(/mark it completed/i)).not.toBeInTheDocument();
  });

  it("saving a review calls updateReviewAction independently, and shows the two-button nudge when the action signals showNudge", async () => {
    updateReviewActionMock.mockResolvedValue({ review: "Loved it", showNudge: true });

    render(<NotesReview itemId="item-1" notes={null} review={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a review" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Review" }), {
      target: { value: "Loved it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateReviewActionMock).toHaveBeenCalledWith("item-1", "Loved it"));
    expect(updateNotesActionMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/mark it completed/i)).toBeInTheDocument());
    // Two buttons only -- Mark Completed / Dismiss, no "Just save"/"Cancel".
    expect(screen.getByRole("button", { name: "Mark Completed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("does not show the nudge when the save result signals showNudge: false", async () => {
    updateReviewActionMock.mockResolvedValue({ review: "Fine, I guess", showNudge: false });

    render(<NotesReview itemId="item-1" notes={null} review={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a review" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Review" }), {
      target: { value: "Fine, I guess" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Fine, I guess")).toBeInTheDocument());
    expect(screen.queryByText(/mark it completed/i)).not.toBeInTheDocument();
  });

  it("'Mark Completed' on the review nudge calls markItemCompletedAction and dismisses the banner", async () => {
    updateReviewActionMock.mockResolvedValue({ review: "Loved it", showNudge: true });
    markItemCompletedActionMock.mockResolvedValue({ success: true });

    render(<NotesReview itemId="item-1" notes={null} review={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a review" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Review" }), {
      target: { value: "Loved it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText(/mark it completed/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Mark Completed" }));

    await waitFor(() => expect(markItemCompletedActionMock).toHaveBeenCalledWith("item-1"));
    await waitFor(() => expect(screen.queryByText(/mark it completed/i)).not.toBeInTheDocument());
  });

  it("'Dismiss' on the review nudge hides the banner without calling markItemCompletedAction", async () => {
    updateReviewActionMock.mockResolvedValue({ review: "Loved it", showNudge: true });

    render(<NotesReview itemId="item-1" notes={null} review={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a review" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Review" }), {
      target: { value: "Loved it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText(/mark it completed/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(markItemCompletedActionMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/mark it completed/i)).not.toBeInTheDocument();
  });

  it("Notes and Review save independently -- editing one leaves the other's draft/expanded state untouched", () => {
    render(<NotesReview itemId="item-1" notes={null} review="Existing review" />);

    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));

    expect(screen.getByRole("textbox", { name: "Notes" })).toBeInTheDocument();
    // Review's populated display is untouched by Notes entering edit mode.
    expect(screen.getByText("Existing review")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Review" })).not.toBeInTheDocument();
  });
});
