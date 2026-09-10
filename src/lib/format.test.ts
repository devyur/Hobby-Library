import { describe, expect, it } from "vitest";

import { formatDate, formatDateOnly, formatFileSize } from "./format";

describe("formatDate", () => {
  it("renders an ISO timestamp as a human-readable medium date", () => {
    expect(formatDate("2026-01-15T12:00:00.000Z")).toBe("Jan 15, 2026");
  });
});

describe("formatDateOnly", () => {
  // Issue #34: completed_at is stored as UTC midnight. formatDate() above
  // renders in the viewer's local timezone, so a viewer behind UTC (e.g.
  // America/Los_Angeles) would see the date roll back a day. formatDateOnly
  // forces timeZone: "UTC" so the displayed calendar date always matches
  // what was actually picked/stored, independent of the machine running
  // this test.
  it("renders a UTC-midnight date-only value as the same calendar date, not shifted by local timezone", () => {
    expect(formatDateOnly("2022-07-04T00:00:00.000Z")).toBe("Jul 4, 2022");
  });
});

describe("formatFileSize", () => {
  it("renders sub-1024-byte sizes in bytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("renders an exact KB size with no decimal", () => {
    expect(formatFileSize(43008)).toBe("42 KB");
  });

  it("renders a sub-10 unit value with one decimal place", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("renders MB sizes", () => {
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3 MB");
  });
});
