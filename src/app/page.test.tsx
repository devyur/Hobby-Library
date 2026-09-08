import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home page", () => {
  it("shows the Hobby Library placeholder content", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: /hobby library/i }),
    ).toBeInTheDocument();
  });
});
