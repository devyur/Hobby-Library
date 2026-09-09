import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const attachTagActionMock = vi.fn();
const detachTagActionMock = vi.fn();
const addTagToItemActionMock = vi.fn();
vi.mock("@/lib/actions/tags", () => ({
  attachTagAction: (...args: unknown[]) => attachTagActionMock(...args),
  detachTagAction: (...args: unknown[]) => detachTagActionMock(...args),
  addTagToItemAction: (...args: unknown[]) => addTagToItemActionMock(...args),
}));

import { ItemTagsEditor, type TagOption } from "./ItemTagsEditor";

// Component coverage for the always-interactive Tags editor (issue #17).
// Each attach/detach is asserted as its own immediate Server Action call
// (not batched, not gated behind any form submit), and the client-side
// empty/whitespace rejection is asserted to never call the Server Action at
// all -- the live end-to-end flow (autocomplete suggestions, the real DB
// round trip) is covered by e2e/item-tags.spec.ts instead. Same
// fireEvent-based interaction style as LibraryView.test.tsx/
// NavLinks.test.tsx/ThemeToggle.test.tsx.

function Wrapper({
  initialTags,
  suggestionPool,
}: {
  initialTags: TagOption[];
  suggestionPool: TagOption[];
}) {
  const [tags, setTags] = useState(initialTags);
  return (
    <ItemTagsEditor
      itemId="item-1"
      tags={tags}
      onTagsChange={setTags}
      suggestionPool={suggestionPool}
    />
  );
}

describe("ItemTagsEditor", () => {
  afterEach(() => {
    cleanup();
    attachTagActionMock.mockReset();
    detachTagActionMock.mockReset();
    addTagToItemActionMock.mockReset();
  });

  it("renders each attached tag with its own remove control", () => {
    render(
      <Wrapper
        initialTags={[
          { id: "tag-1", name: "RPG" },
          { id: "tag-2", name: "Cozy" },
        ]}
        suggestionPool={[]}
      />,
    );

    expect(screen.getByText("RPG")).toBeInTheDocument();
    expect(screen.getByText("Cozy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove RPG" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Cozy" })).toBeInTheDocument();
  });

  it("detaching one tag calls detachTagAction for only that tag, as its own immediate call", async () => {
    detachTagActionMock.mockResolvedValue({ success: true });

    render(
      <Wrapper
        initialTags={[
          { id: "tag-1", name: "RPG" },
          { id: "tag-2", name: "Cozy" },
        ]}
        suggestionPool={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove RPG" }));

    await waitFor(() => expect(detachTagActionMock).toHaveBeenCalledWith("item-1", "tag-1"));
    expect(detachTagActionMock).toHaveBeenCalledTimes(1);
    // The other tag is untouched, both in the DOM and as a call.
    expect(screen.getByText("Cozy")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("RPG")).not.toBeInTheDocument());
  });

  it("suggestions exclude tags already attached to this item and filter case-insensitively by substring", () => {
    render(
      <Wrapper
        initialTags={[{ id: "tag-1", name: "Python" }]}
        suggestionPool={[
          { id: "tag-1", name: "Python" },
          { id: "tag-2", name: "python-web" },
          { id: "tag-3", name: "Cozy" },
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Add a tag"), { target: { value: "PY" } });

    expect(screen.getByRole("button", { name: "python-web" })).toBeInTheDocument();
    // "Python" is already attached -- excluded from suggestions even though
    // it matches the substring.
    expect(screen.queryByRole("button", { name: "Python" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cozy" })).not.toBeInTheDocument();
  });

  it("selecting a suggestion attaches it via attachTagAction", async () => {
    attachTagActionMock.mockResolvedValue({ tag: { id: "tag-2", name: "python-web" } });

    render(<Wrapper initialTags={[]} suggestionPool={[{ id: "tag-2", name: "python-web" }]} />);

    fireEvent.change(screen.getByLabelText("Add a tag"), { target: { value: "py" } });
    fireEvent.click(screen.getByRole("button", { name: "python-web" }));

    await waitFor(() => expect(attachTagActionMock).toHaveBeenCalledWith("item-1", "tag-2"));
    expect(addTagToItemActionMock).not.toHaveBeenCalled();
  });

  it("submitting a typed name (Enter) that doesn't match a suggestion calls addTagToItemAction", async () => {
    addTagToItemActionMock.mockResolvedValue({ tag: { id: "tag-new", name: "Speedrunning" } });

    render(<Wrapper initialTags={[]} suggestionPool={[]} />);

    const input = screen.getByLabelText("Add a tag");
    fireEvent.change(input, { target: { value: "Speedrunning" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(addTagToItemActionMock).toHaveBeenCalledWith("item-1", "Speedrunning"),
    );
    await waitFor(() => expect(screen.getByText("Speedrunning")).toBeInTheDocument());
  });

  it("rejects an empty/whitespace-only submission client-side, never calling the Server Action", () => {
    render(<Wrapper initialTags={[]} suggestionPool={[]} />);

    const input = screen.getByLabelText("Add a tag");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(addTagToItemActionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("rolls back the optimistic removal and shows an error if detach fails server-side", async () => {
    detachTagActionMock.mockResolvedValue({ error: "Failed to remove tag. Please try again." });

    render(<Wrapper initialTags={[{ id: "tag-1", name: "RPG" }]} suggestionPool={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove RPG" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("RPG")).toBeInTheDocument();
  });
});
