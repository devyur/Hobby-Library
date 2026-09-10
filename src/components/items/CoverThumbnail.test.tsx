import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CoverThumbnail } from "./CoverThumbnail";

describe("CoverThumbnail", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a defined placeholder (not a broken/empty box) when there is no cover", () => {
    render(<CoverThumbnail coverUrl={null} title="Untitled Item" />);
    expect(
      screen.getByRole("img", { name: /no cover image for untitled item/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /^cover for/i })).not.toBeInTheDocument();
  });

  it("renders nothing when there is no cover and hideWhenEmpty is set (item detail page's Upload control)", () => {
    const { container } = render(
      <CoverThumbnail coverUrl={null} title="Untitled Item" hideWhenEmpty />,
    );
    expect(
      screen.queryByRole("img", { name: /no cover image for untitled item/i }),
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the cover image with an alt text when a signed URL is present", () => {
    render(
      <CoverThumbnail
        coverUrl="https://example.supabase.co/storage/v1/object/sign/covers/x.png?token=abc"
        title="My Item"
      />,
    );
    const img = screen.getByRole("img", { name: "Cover for My Item" });
    expect(img).toHaveAttribute(
      "src",
      "https://example.supabase.co/storage/v1/object/sign/covers/x.png?token=abc",
    );
  });
});
