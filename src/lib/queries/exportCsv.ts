import type { ExportData, ExportItem } from "./export";

// Pure ExportData -> CSV string conversion for the CSV export format (issue
// #45), deliberately isolated in its own file per the issue's explicit
// "easy to revert/mute" constraint: no Supabase import, no dependency on
// anything beyond the already-assembled ExportData shape (built by
// buildExportData() in ./export.ts, untouched by this file), and not
// consumed anywhere except the CSV branch of
// src/app/api/export/route.ts. Deleting this file plus that one branch and
// the Settings button fully removes CSV export with nothing else to touch.
//
// RFC 4180 field escaping is hand-rolled rather than pulling in a CSV
// library (issue #45 Constraints, "no new npm dependency"): a field is
// quote-wrapped, with internal `"` doubled, only when it contains a comma,
// a double quote, or a newline -- otherwise emitted bare.

const HEADER = [
  "Title",
  "Category",
  "Subtype",
  "Status",
  "Priority",
  "Rating",
  "Notes",
  "Review",
  "Tags",
  "Links",
  "Lists",
  "Created At",
  "Updated At",
  "Completed At",
];

// `,` is already the CSV field delimiter, so multi-value cells (Tags/Links/
// Lists) join on `; ` instead (issue #45 Constraints). A tag/list name that
// itself contains a `;` renders ambiguously -- a known, accepted limitation
// per the issue, not fixed here.
const MULTI_VALUE_DELIMITER = "; ";

function escapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toRow(fields: string[]): string {
  return fields.map(escapeField).join(",");
}

// Which of the caller's own lists this item currently belongs to, derived
// from data.lists[].item_ids (already deduped against trashed/dangling
// membership by buildExportData()) -- not a new query, and intentionally
// not encoding per-list sort_order/position (issue #45 Decisions: CSV's
// Lists column says which lists, not where in each list).
function listsForItem(data: ExportData, itemId: string): string {
  return data.lists
    .filter((list) => list.item_ids.includes(itemId))
    .map((list) => list.name)
    .join(MULTI_VALUE_DELIMITER);
}

function itemToRow(item: ExportItem, data: ExportData): string {
  const fields = [
    item.title,
    item.category,
    item.subtype.name,
    item.status,
    item.priority ?? "",
    item.rating === null ? "" : String(item.rating),
    item.notes ?? "",
    item.review ?? "",
    item.tags.map((tag) => tag.name).join(MULTI_VALUE_DELIMITER),
    item.links
      .map((link) => (link.label ? `${link.label} (${link.url})` : link.url))
      .join(MULTI_VALUE_DELIMITER),
    listsForItem(data, item.id),
    item.created_at,
    item.updated_at,
    item.completed_at ?? "",
  ];
  return toRow(fields);
}

// Leading UTF-8 BOM (issue #45 AC) so Excel renders non-ASCII characters
// (e.g. an accented title) correctly instead of mojibake -- the
// escape below encodes to the 3-byte UTF-8 BOM once this string is sent as
// a UTF-8 response body. Row terminators are CRLF per RFC 4180.
const BOM = "﻿";

export function buildExportCsv(data: ExportData): string {
  const rows = [toRow(HEADER), ...data.items.map((item) => itemToRow(item, data))];
  return BOM + rows.join("\r\n") + "\r\n";
}
