import { describe, expect, it } from "vitest";

import { buildNavItems, isNavItemActive } from "./navItems";

describe("buildNavItems", () => {
  it("orders Dashboard, then categories in the given order, then Custom Lists, Settings", () => {
    const items = buildNavItems([
      { id: "1", slug: "games", name: "Games" },
      { id: "2", slug: "books", name: "Books" },
    ]);

    expect(items).toEqual([
      { label: "Dashboard", href: "/dashboard" },
      { label: "Games", href: "/games" },
      { label: "Books", href: "/books" },
      { label: "Custom Lists", href: "/lists" },
      { label: "Settings", href: "/settings" },
    ]);
  });

  it("renders no category tabs when categories is empty, without hardcoding any", () => {
    const items = buildNavItems([]);

    expect(items).toEqual([
      { label: "Dashboard", href: "/dashboard" },
      { label: "Custom Lists", href: "/lists" },
      { label: "Settings", href: "/settings" },
    ]);
  });

  it("links each category tab to /<slug>", () => {
    const items = buildNavItems([
      { id: "1", slug: "audio", name: "Audio" },
    ]);

    expect(items.find((item) => item.label === "Audio")).toEqual({
      label: "Audio",
      href: "/audio",
    });
  });
});

describe("isNavItemActive", () => {
  it("matches the exact path", () => {
    expect(isNavItemActive("/dashboard", "/dashboard")).toBe(true);
  });

  it("matches a sub-route beneath the item's own path", () => {
    expect(isNavItemActive("/games/some-item-id", "/games")).toBe(true);
    expect(isNavItemActive("/lists/my-list", "/lists")).toBe(true);
  });

  it("does not match an unrelated path, including one that merely starts with the same prefix", () => {
    expect(isNavItemActive("/books", "/games")).toBe(false);
    expect(isNavItemActive("/gamesomething", "/games")).toBe(false);
  });

  it("does not match a parent path when the item is the more specific one", () => {
    expect(isNavItemActive("/games", "/games/some-item-id")).toBe(false);
  });
});
