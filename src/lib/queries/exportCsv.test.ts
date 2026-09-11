import { describe, expect, it } from "vitest";

import { buildExportCsv } from "./exportCsv";
import type { ExportData, ExportItem } from "./export";

// Unit coverage for buildExportCsv (issue #45) -- a pure ExportData -> CSV
// string function, so unlike export.test.ts there's no Supabase client to
// mock; every case here just hand-builds an ExportData fixture. The live
// download response (headers, actual RFC 4180 shape against a real
// spreadsheet-compatible parser) is covered separately by
// e2e/export-csv.spec.ts against the real project.

const BOM = "﻿";

function baseItem(overrides: Partial<ExportItem> = {}): ExportItem {
  return {
    id: "item-1",
    title: "Bare Item",
    category: "games",
    subtype: { name: "RPG", is_custom: false },
    status: "planned",
    priority: null,
    rating: null,
    notes: null,
    review: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    completed_at: null,
    tags: [],
    links: [],
    images: [],
    attachments: [],
    ...overrides,
  };
}

function baseData(items: ExportItem[], lists: ExportData["lists"] = []): ExportData {
  return {
    schema_version: 1,
    exported_at: "2026-01-03T00:00:00.000Z",
    items,
    lists,
  };
}

const HEADER_ROW =
  "Title,Category,Subtype,Status,Priority,Rating,Notes,Review,Tags,Links,Lists,Created At,Updated At,Completed At";

describe("buildExportCsv", () => {
  it("leads with a UTF-8 BOM followed by the header row", () => {
    const csv = buildExportCsv(baseData([]));
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(BOM.length).split("\r\n")[0]).toBe(HEADER_ROW);
  });

  it("a user with zero items gets header-only output, not an error or zero bytes", () => {
    const csv = buildExportCsv(baseData([]));
    expect(csv).toBe(`${BOM}${HEADER_ROW}\r\n`);
    expect(csv.length).toBeGreaterThan(0);
  });

  it("an item with tags/links/list-membership populated produces the exact expected row", () => {
    const item = baseItem({
      id: "item-1",
      title: "Mass Effect 2",
      category: "games",
      subtype: { name: "RPG", is_custom: false },
      status: "completed",
      priority: "high",
      rating: 9,
      notes: "great",
      review: "loved it",
      tags: [
        { name: "sci-fi", is_custom: false },
        { name: "my-custom-tag", is_custom: true },
      ],
      links: [
        { url: "https://example.com/me2", label: "Store page" },
        { url: "https://example.com/bare", label: null },
      ],
      created_at: "2026-01-04T10:00:00.000Z",
      updated_at: "2026-03-01T12:00:00.000Z",
      completed_at: "2026-02-20T00:00:00.000Z",
    });
    const data = baseData(
      [item],
      [
        { name: "Backlog", created_at: "2026-01-01T00:00:00.000Z", item_ids: ["item-1"] },
        { name: "Not This One", created_at: "2026-01-01T00:00:00.000Z", item_ids: ["item-2"] },
      ],
    );

    const csv = buildExportCsv(data);
    const lines = csv.slice(BOM.length).split("\r\n");
    expect(lines[0]).toBe(HEADER_ROW);
    expect(lines[1]).toBe(
      [
        "Mass Effect 2",
        "games",
        "RPG",
        "completed",
        "high",
        "9",
        "great",
        "loved it",
        "sci-fi; my-custom-tag",
        "Store page (https://example.com/me2); https://example.com/bare",
        "Backlog",
        "2026-01-04T10:00:00.000Z",
        "2026-03-01T12:00:00.000Z",
        "2026-02-20T00:00:00.000Z",
      ].join(","),
    );
  });

  it("an item with no tags/links/lists/nullable fields produces empty-string cells, not omitted columns or the literal 'null'", () => {
    const item = baseItem({ id: "item-1", title: "Bare Item" });
    const csv = buildExportCsv(baseData([item]));
    const row = csv.slice(BOM.length).split("\r\n")[1];
    expect(row).toBe("Bare Item,games,RPG,planned,,,,,,,,2026-01-01T00:00:00.000Z,2026-01-02T00:00:00.000Z,");
  });

  it("RFC 4180-escapes a field containing a comma, a quote, and a newline", () => {
    const item = baseItem({
      id: "item-1",
      title: "Plain Title",
      notes: 'Has a comma, a "quote", and\na newline',
    });
    const csv = buildExportCsv(baseData([item]));
    const row = csv.slice(BOM.length).split("\r\n")[1];
    // The Notes field (9th column) is quote-wrapped with internal quotes
    // doubled; the embedded \n does not split the row.
    expect(row).toBe(
      'Plain Title,games,RPG,planned,,,"Has a comma, a ""quote"", and\na newline",,,,,2026-01-01T00:00:00.000Z,2026-01-02T00:00:00.000Z,',
    );
    // Exactly two data rows worth of \r\n-delimited lines despite the
    // embedded bare \n inside the quoted field.
    expect(csv.slice(BOM.length).split("\r\n")).toHaveLength(3); // header + 1 row + trailing empty
  });
});
