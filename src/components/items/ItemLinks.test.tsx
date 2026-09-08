import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ItemLinks } from "./ItemLinks";

describe("ItemLinks", () => {
  afterEach(() => {
    cleanup();
  });

  it("always renders the Links heading, even with zero links", () => {
    render(<ItemLinks links={[]} />);
    expect(screen.getByRole("heading", { name: "Links" })).toBeInTheDocument();
    expect(screen.getByText("No links yet")).toBeInTheDocument();
  });

  it("renders a link's label as the link text when set", () => {
    render(
      <ItemLinks
        links={[{ id: "1", url: "https://example.com/store", label: "Store page" }]}
      />,
    );
    const link = screen.getByRole("link", { name: "Store page" });
    expect(link).toHaveAttribute("href", "https://example.com/store");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("falls back to the raw url as link text when label is null", () => {
    render(<ItemLinks links={[{ id: "1", url: "https://example.com/x", label: null }]} />);
    expect(screen.getByRole("link", { name: "https://example.com/x" })).toBeInTheDocument();
  });
});
