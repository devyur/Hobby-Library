import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RatingBadge } from "./RatingBadge";

describe("RatingBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when rating is null", () => {
    const { container } = render(<RatingBadge rating={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders "X/10", never "0/10", for a real rating', () => {
    render(<RatingBadge rating={7} />);
    expect(screen.getByText("7/10")).toBeInTheDocument();
  });

  it('renders "0/10" only if the rating value is literally 0 (never substituted for null)', () => {
    render(<RatingBadge rating={0} />);
    expect(screen.getByText("0/10")).toBeInTheDocument();
  });
});
