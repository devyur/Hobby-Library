import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const addLinkActionMock = vi.fn();
const removeLinkActionMock = vi.fn();
vi.mock("@/lib/actions/links", () => ({
  addLinkAction: (...args: unknown[]) => addLinkActionMock(...args),
  removeLinkAction: (...args: unknown[]) => removeLinkActionMock(...args),
}));

import { ItemLinksEditor, type LinkOption } from "./ItemLinksEditor";

// Component coverage for the always-interactive Links editor (issue #20),
// same shape as ItemTagsEditor.test.tsx (#17): each add/remove asserted as
// its own immediate Server Action call, client-side URL rejection asserted
// to never call the Server Action at all. The live end-to-end flow (real DB
// round trip, insertion order across a reload) is covered by
// e2e/item-links.spec.ts instead.

function renderEditor(initialLinks: LinkOption[] = []) {
  return render(<ItemLinksEditor itemId="item-1" initialLinks={initialLinks} />);
}

describe("ItemLinksEditor", () => {
  afterEach(() => {
    cleanup();
    addLinkActionMock.mockReset();
    removeLinkActionMock.mockReset();
  });

  it("renders the empty state when the item has zero links", () => {
    renderEditor([]);
    expect(screen.getByRole("heading", { name: "Links" })).toBeInTheDocument();
    expect(screen.getByText("No links yet")).toBeInTheDocument();
  });

  it("renders each link as a clickable anchor with its own remove control", () => {
    renderEditor([
      { id: "link-1", url: "https://example.com/store", label: "Store page" },
      { id: "link-2", url: "https://example.com/x", label: null },
    ]);

    const withLabel = screen.getByRole("link", { name: "Store page" });
    expect(withLabel).toHaveAttribute("href", "https://example.com/store");
    expect(withLabel).toHaveAttribute("target", "_blank");
    expect(withLabel).toHaveAttribute("rel", "noopener noreferrer");

    // Falls back to the raw url as link text when label is null.
    expect(screen.getByRole("link", { name: "https://example.com/x" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Remove Store page" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove https://example.com/x" }),
    ).toBeInTheDocument();
  });

  it("submitting a well-formed URL calls addLinkAction and clears the fields on success", async () => {
    addLinkActionMock.mockResolvedValue({
      link: { id: "link-new", url: "https://imdb.com/title/1", label: "IMDb" },
    });

    renderEditor([]);

    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://imdb.com/title/1" },
    });
    fireEvent.change(screen.getByLabelText("Label (optional)"), {
      target: { value: "IMDb" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(addLinkActionMock).toHaveBeenCalledWith("item-1", "https://imdb.com/title/1", "IMDb"),
    );
    await waitFor(() => expect(screen.getByRole("link", { name: "IMDb" })).toBeInTheDocument());
    expect(screen.getByLabelText("URL")).toHaveValue("");
    expect(screen.getByLabelText("Label (optional)")).toHaveValue("");
  });

  it("rejects a schemeless URL client-side, never calling the Server Action", () => {
    renderEditor([]);

    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "imdb.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(addLinkActionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("rejects a javascript: scheme URL client-side, never calling the Server Action", () => {
    renderEditor([]);

    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(addLinkActionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("removing one link calls removeLinkAction for only that link, as its own immediate call", async () => {
    removeLinkActionMock.mockResolvedValue({ success: true });

    renderEditor([
      { id: "link-1", url: "https://example.com/a", label: "A" },
      { id: "link-2", url: "https://example.com/b", label: "B" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove A" }));

    await waitFor(() => expect(removeLinkActionMock).toHaveBeenCalledWith("item-1", "link-1"));
    expect(removeLinkActionMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("B")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("A")).not.toBeInTheDocument());
  });

  it("rolls back the optimistic removal and shows an error if remove fails server-side", async () => {
    removeLinkActionMock.mockResolvedValue({ error: "Failed to remove link. Please try again." });

    renderEditor([{ id: "link-1", url: "https://example.com/a", label: "A" }]);

    fireEvent.click(screen.getByRole("button", { name: "Remove A" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
