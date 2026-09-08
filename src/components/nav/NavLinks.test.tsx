import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const usePathnameMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

import { NavLinks } from "./NavLinks";

const items = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Games", href: "/games" },
  { label: "Custom Lists", href: "/lists" },
];

describe("NavLinks", () => {
  afterEach(() => {
    cleanup();
    usePathnameMock.mockReset();
  });

  it("marks the item matching the current pathname as the active page", () => {
    usePathnameMock.mockReturnValue("/games");

    render(<NavLinks items={items} />);

    expect(screen.getByRole("link", { name: "Games" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks a nav item active on a sub-route beneath it", () => {
    usePathnameMock.mockReturnValue("/lists/my-list-id");

    render(<NavLinks items={items} />);

    expect(screen.getByRole("link", { name: "Custom Lists" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("calls onNavigate when a link is clicked", () => {
    usePathnameMock.mockReturnValue("/dashboard");
    const onNavigate = vi.fn();

    render(<NavLinks items={items} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "Games" }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
