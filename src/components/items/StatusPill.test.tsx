import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    ["planned", "Planned", "bg-status-planned-bg"],
    ["ongoing", "Ongoing", "bg-status-ongoing-bg"],
    ["completed", "Completed", "bg-status-completed-bg"],
    ["dropped", "Dropped", "bg-status-dropped-bg"],
  ] as const)("renders the %s label with its status color class", (status, label, className) => {
    render(<StatusPill status={status} />);
    const pill = screen.getByText(label);
    expect(pill.className).toContain(className);
  });
});
