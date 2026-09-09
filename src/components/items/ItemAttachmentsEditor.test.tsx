import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const uploadAttachmentActionMock = vi.fn();
const removeAttachmentActionMock = vi.fn();
vi.mock("@/lib/actions/attachments", () => ({
  uploadAttachmentAction: (...args: unknown[]) => uploadAttachmentActionMock(...args),
  removeAttachmentAction: (...args: unknown[]) => removeAttachmentActionMock(...args),
}));

import { ItemAttachmentsEditor, type AttachmentOption } from "./ItemAttachmentsEditor";

// Component coverage for the always-interactive Attachments editor (issue
// #21), same shape as ItemLinksEditor.test.tsx (#20): each upload/remove
// asserted as its own immediate Server Action call, client-side
// type/size rejection asserted to never call the Server Action at all. The
// live end-to-end flow (real Storage/DB round trip, download, cross-user
// RLS) is covered by e2e/item-attachments.spec.ts instead.

function renderEditor(initialAttachments: AttachmentOption[] = []) {
  return render(
    <ItemAttachmentsEditor itemId="item-1" initialAttachments={initialAttachments} />,
  );
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText("Attachment file", { selector: "input" });
}

describe("ItemAttachmentsEditor", () => {
  afterEach(() => {
    cleanup();
    uploadAttachmentActionMock.mockReset();
    removeAttachmentActionMock.mockReset();
  });

  it("renders the empty state when the item has zero attachments", () => {
    renderEditor([]);
    expect(screen.getByRole("heading", { name: "Attachments" })).toBeInTheDocument();
    expect(screen.getByText("No attachments yet")).toBeInTheDocument();
  });

  it("renders each attachment with filename, human-readable size, a download link, and a remove control", () => {
    renderEditor([
      {
        id: "a-1",
        filename: "guide.pdf",
        mimeType: "application/pdf",
        sizeBytes: 43008,
        downloadUrl: "https://signed.example.com/guide.pdf",
      },
    ]);

    expect(screen.getByText("guide.pdf")).toBeInTheDocument();
    expect(screen.getByText("42 KB · application/pdf")).toBeInTheDocument();
    const downloadLink = screen.getByRole("link", { name: "Download" });
    expect(downloadLink).toHaveAttribute("href", "https://signed.example.com/guide.pdf");
    expect(screen.getByRole("button", { name: "Remove guide.pdf" })).toBeInTheDocument();
  });

  it("selecting a valid .md file calls uploadAttachmentAction and adds it to the list on success", async () => {
    uploadAttachmentActionMock.mockResolvedValue({
      attachment: {
        id: "a-new",
        filename: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 20,
        downloadUrl: "https://signed.example.com/notes.md",
      },
    });

    renderEditor([]);

    const file = new File(["hello"], "notes.md", { type: "" });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    await waitFor(() =>
      expect(uploadAttachmentActionMock).toHaveBeenCalledWith("item-1", file),
    );
    await waitFor(() => expect(screen.getByText("notes.md")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "https://signed.example.com/notes.md",
    );
  });

  it("rejects a disallowed extension client-side, never calling the Server Action", () => {
    renderEditor([]);

    const file = new File(["hello"], "script.exe", { type: "application/octet-stream" });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(uploadAttachmentActionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/\.txt, \.md, or \.pdf/i);
  });

  it("rejects an oversized file client-side, never calling the Server Action", () => {
    renderEditor([]);

    const oversized = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "notes.txt", {
      type: "text/plain",
    });
    fireEvent.change(fileInput(), { target: { files: [oversized] } });

    expect(uploadAttachmentActionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/2 mb or smaller/i);
  });

  it("removing one attachment calls removeAttachmentAction for only that attachment, as its own immediate call", async () => {
    removeAttachmentActionMock.mockResolvedValue({ success: true });

    renderEditor([
      { id: "a-1", filename: "a.txt", mimeType: "text/plain", sizeBytes: 10, downloadUrl: null },
      { id: "a-2", filename: "b.txt", mimeType: "text/plain", sizeBytes: 10, downloadUrl: null },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove a.txt" }));

    await waitFor(() =>
      expect(removeAttachmentActionMock).toHaveBeenCalledWith("item-1", "a-1"),
    );
    expect(removeAttachmentActionMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("b.txt")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("a.txt")).not.toBeInTheDocument());
  });

  it("rolls back the optimistic removal and shows an error if remove fails server-side", async () => {
    removeAttachmentActionMock.mockResolvedValue({
      error: "Failed to remove attachment. Please try again.",
    });

    renderEditor([
      { id: "a-1", filename: "a.txt", mimeType: "text/plain", sizeBytes: 10, downloadUrl: null },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove a.txt" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("a.txt")).toBeInTheDocument();
  });

  it("disables the upload control and shows an explanatory message once the item already has 10 attachments", () => {
    const tenAttachments: AttachmentOption[] = Array.from({ length: 10 }, (_, index) => ({
      id: `a-${index}`,
      filename: `file-${index}.txt`,
      mimeType: "text/plain",
      sizeBytes: 10,
      downloadUrl: null,
    }));

    renderEditor(tenAttachments);

    expect(fileInput()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add attachment" })).toBeDisabled();
    expect(screen.getByText(/maximum allowed/i)).toBeInTheDocument();
  });
});
