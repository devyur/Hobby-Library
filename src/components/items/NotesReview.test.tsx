import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NotesReview } from "./NotesReview";

describe("NotesReview", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when both notes and review are null", () => {
    const { container } = render(<NotesReview notes={null} review={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders only Notes when review is null", () => {
    render(<NotesReview notes="Working notes here" review={null} />);
    expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByText("Working notes here")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Review" })).not.toBeInTheDocument();
  });

  it("renders only Review when notes is null", () => {
    render(<NotesReview notes={null} review="My considered opinion" />);
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByText("My considered opinion")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Notes" })).not.toBeInTheDocument();
  });

  it("renders both independently with visually distinct containers", () => {
    render(<NotesReview notes="Some notes" review="Some review" />);

    const notesHeading = screen.getByRole("heading", { name: "Notes" });
    const reviewHeading = screen.getByRole("heading", { name: "Review" });
    expect(notesHeading).toBeInTheDocument();
    expect(reviewHeading).toBeInTheDocument();

    const notesBlock = screen.getByText("Some notes");
    const reviewBlock = screen.getByText("Some review");

    // Distinct container treatment: different background token and border
    // style, not just two plain paragraphs with the same styling.
    expect(notesBlock.className).not.toBe(reviewBlock.className);
    expect(notesBlock.className).toContain("bg-surface");
    expect(reviewBlock.className).toContain("bg-bg");
    expect(reviewBlock.className).toContain("italic");
  });
});
