import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TagChips } from "./TagChips";

describe("TagChips", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when there are no tags", () => {
    const { container } = render(<TagChips tags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every tag as a chip when they fit within maxVisible", () => {
    render(<TagChips tags={["rpg", "cozy"]} maxVisible={3} />);
    expect(screen.getByText("rpg")).toBeInTheDocument();
    expect(screen.getByText("cozy")).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });

  it("truncates to maxVisible chips and shows a +N overflow indicator for the rest", () => {
    render(
      <TagChips tags={["a", "b", "c", "d", "e"]} maxVisible={3} />,
    );
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.queryByText("d")).not.toBeInTheDocument();
    expect(screen.queryByText("e")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
