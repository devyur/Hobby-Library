import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ItemAttachments } from "./ItemAttachments";

describe("ItemAttachments", () => {
  afterEach(() => {
    cleanup();
  });

  it("always renders the Attachments heading, even with zero attachments", () => {
    render(<ItemAttachments attachments={[]} />);
    expect(screen.getByRole("heading", { name: "Attachments" })).toBeInTheDocument();
    expect(screen.getByText("No attachments yet")).toBeInTheDocument();
  });

  it("renders filename, human-readable size, and type as plain metadata with no download link", () => {
    render(
      <ItemAttachments
        attachments={[
          { id: "1", filename: "guide.pdf", mimeType: "application/pdf", sizeBytes: 43008 },
        ]}
      />,
    );
    expect(screen.getByText("guide.pdf")).toBeInTheDocument();
    expect(screen.getByText("42 KB · application/pdf")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
