import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PriorityBadge } from "./PriorityBadge";

describe("PriorityBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when priority is null", () => {
    const { container } = render(
      <PriorityBadge status="planned" priority={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a non-planned status, even with a priority set", () => {
    const { container } = render(
      <PriorityBadge status="ongoing" priority="high" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the label when status is planned and priority is set", () => {
    render(<PriorityBadge status="planned" priority="high" />);
    expect(screen.getByText("High")).toBeInTheDocument();
  });
});
