import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { LocalDate } from "./LocalDate";
import { formatDate, formatDateOnly } from "@/lib/format";

afterEach(cleanup);

// Issue #46: formatDate() renders a genuine timestamp in the *viewer's*
// local timezone, which is correct by design -- but calling it directly
// during SSR and the client's first render can produce a real React
// hydration mismatch near a local-midnight boundary, since the server and
// client can land on different calendar dates for the same instant.
// LocalDate.tsx fixes this by rendering formatDateOnly()'s UTC-forced,
// host-timezone-independent string as a stable first-paint placeholder, then
// swapping in formatDate()'s real local-time value from a useEffect (which
// only runs post-hydration). These tests cover both halves of that fix,
// plus a direct hydration check reproducing the actual bug class.
describe("LocalDate", () => {
  const iso = "2026-01-15T12:00:00.000Z";

  it("server-renders the timezone-independent placeholder, not the local-time value", () => {
    const html = renderToString(<LocalDate iso={iso} />);
    expect(html).toBe(formatDateOnly(iso));
  });

  it("swaps to the real local-time value once mounted client-side", async () => {
    render(<LocalDate iso={iso} />);
    expect(await screen.findByText(formatDate(iso))).toBeInTheDocument();
  });

  it("hydrates SSR-rendered markup with no React hydration-mismatch warning", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<LocalDate iso={iso} />);
    document.body.appendChild(container);

    const originalError = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      await act(async () => {
        hydrateRoot(container, <LocalDate iso={iso} />);
      });
    } finally {
      console.error = originalError;
      document.body.removeChild(container);
    }

    expect(errors.filter((message) => /hydrat/i.test(message))).toEqual([]);
  });
});
