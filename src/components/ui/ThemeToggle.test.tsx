import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Supabase client / the Server Action are mocked here -- this test exercises
// ThemeToggle's own local/optimistic logic (issue #8, acceptance criteria
// D), not a real network round-trip. The Server Action's actual live-DB
// write is verified separately (temporary debug test/page, reverted before
// merge, per the issue).
const getSessionMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: getSessionMock },
  }),
}));

const updateThemePreferenceMock = vi.fn();
vi.mock("@/lib/actions/preferences", () => ({
  updateThemePreference: (...args: unknown[]) =>
    updateThemePreferenceMock(...args),
}));

import { ThemeToggle } from "./ThemeToggle";

const THEME_STORAGE_KEY = "hobby-library-theme";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    getSessionMock.mockReset();
    updateThemePreferenceMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("reflects the current data-theme attribute on <html>", () => {
    document.documentElement.setAttribute("data-theme", "dark");

    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: /toggle theme/i })).toHaveTextContent(
      "Dark",
    );
  });

  it("logged-out session: flips data-theme and writes localStorage, without calling the Server Action or throwing", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    getSessionMock.mockResolvedValue({ data: { session: null } });

    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: /toggle theme/i }));

    // The DOM/localStorage change applies immediately (no server round-trip
    // needed to see the effect).
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await waitFor(() => expect(getSessionMock).toHaveBeenCalledTimes(1));
    expect(updateThemePreferenceMock).not.toHaveBeenCalled();
  });

  it("authenticated session: also invokes updateThemePreference with the new theme", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "test-user-id" } } },
    });
    updateThemePreferenceMock.mockResolvedValue({ error: null });

    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: /toggle theme/i }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    await waitFor(() =>
      expect(updateThemePreferenceMock).toHaveBeenCalledWith("dark"),
    );
  });

  it("toggling twice flips back to the original theme", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    getSessionMock.mockResolvedValue({ data: { session: null } });

    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /toggle theme/i });

    fireEvent.click(button);
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark"),
    );

    fireEvent.click(button);
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe(
        "light",
      ),
    );
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
