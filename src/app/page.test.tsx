import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Same createClient-mocking shape as lib/actions/trash.test.ts /
// attachments.test.ts, plus mocks for next/navigation's redirect() and the
// shared getPostAuthRedirect helper so the "already-authenticated visitor"
// branch can be exercised without a real Supabase session.
const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
  }),
}));

const redirectMock = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

const getPostAuthRedirectMock = vi.fn();
vi.mock("@/lib/actions/auth", () => ({
  getPostAuthRedirect: (...args: unknown[]) => getPostAuthRedirectMock(...args),
}));

const { default: Home } = await import("./page");

describe("Home page", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    redirectMock.mockClear();
    getPostAuthRedirectMock.mockReset();
  });

  it("shows Login and Register links for a logged-out visitor", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    render(await Home());

    expect(
      screen.getByRole("heading", { name: /hobby library/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: /register/i })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  it("redirects an already-authenticated visitor instead of showing the marketing page", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    getPostAuthRedirectMock.mockResolvedValue("/dashboard");

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(getPostAuthRedirectMock).toHaveBeenCalledWith("user-1");
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });
});
