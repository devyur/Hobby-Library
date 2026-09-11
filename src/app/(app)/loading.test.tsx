import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import AppLoading from "./loading";

// Issue #59: single top-level Suspense fallback for the (app) route group.
describe("AppLoading", () => {
  afterEach(() => {
    cleanup();
  });

  it("announces loading state via role=status and sr-only text", () => {
    render(<AppLoading />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
  });

  it("renders the dragon GIF as a plain img (not next/image) at 96x96", () => {
    const { container } = render(<AppLoading />);

    // alt="" is intentional (the GIF is decorative; sr-only text above
    // handles the AT announcement) which makes this img implicitly
    // role="presentation" -- query by tag rather than getByRole("img").
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "/dragon-loading.gif");
    expect(img).toHaveAttribute("width", "96");
    expect(img).toHaveAttribute("height", "96");
    expect(img!.className).toContain("h-24");
    expect(img!.className).toContain("w-24");
  });

  it("centers content in a flex column with no overlay/backdrop classes", () => {
    render(<AppLoading />);

    const status = screen.getByRole("status");
    expect(status.className).toContain("flex");
    expect(status.className).toContain("items-center");
    expect(status.className).toContain("justify-center");
    expect(status.className).not.toMatch(/backdrop|overlay|bg-black|\/50/);
  });
});
