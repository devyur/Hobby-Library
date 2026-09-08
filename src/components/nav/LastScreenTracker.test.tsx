import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const usePathnameMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

const updateLastScreenMock = vi.fn();
vi.mock("@/lib/actions/preferences", () => ({
  updateLastScreen: (...args: unknown[]) => updateLastScreenMock(...args),
}));

import { LastScreenTracker } from "./LastScreenTracker";

describe("LastScreenTracker", () => {
  afterEach(() => {
    cleanup();
    usePathnameMock.mockReset();
    updateLastScreenMock.mockReset();
  });

  it("renders nothing", () => {
    usePathnameMock.mockReturnValue("/dashboard");
    updateLastScreenMock.mockResolvedValue({ error: null });

    const { container } = render(<LastScreenTracker />);

    expect(container).toBeEmptyDOMElement();
  });

  it("writes the current pathname on mount (the initial page landed on), not just later navigations", async () => {
    usePathnameMock.mockReturnValue("/games");
    updateLastScreenMock.mockResolvedValue({ error: null });

    render(<LastScreenTracker />);

    await waitFor(() =>
      expect(updateLastScreenMock).toHaveBeenCalledWith("/games"),
    );
  });

  it("does not throw when the write rejects (fire-and-forget)", async () => {
    usePathnameMock.mockReturnValue("/trash");
    updateLastScreenMock.mockRejectedValue(new Error("network hiccup"));

    expect(() => render(<LastScreenTracker />)).not.toThrow();

    await waitFor(() => expect(updateLastScreenMock).toHaveBeenCalledTimes(1));
  });
});
