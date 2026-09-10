// Human-readable formatting helpers (issue #13: item detail page needs
// plain-English dates and file sizes, not raw ISO timestamps/byte counts).
// Kept here rather than inline in a component since both a query result
// (queries/items.ts's docstrings) and multiple components (the page itself,
// ItemAttachments) need the same formatting.

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(iso),
  );
}

// For date-only values (e.g. completed_at, stored as UTC midnight -- see
// issue #34) rather than genuine timestamps. formatDate() above renders in
// the *viewer's* local timezone via Intl.DateTimeFormat, which is correct
// for a real timestamp (created_at, deleted_at) but wrong here: a viewer
// behind UTC (all of the Americas) would see the UTC-midnight instant
// roll back to the previous local calendar day -- e.g. stored
// "2022-07-04T00:00:00.000Z" displaying as "Jul 3, 2022". Force UTC so the
// displayed calendar date always matches the date that was actually
// picked/stored, regardless of viewer timezone. Also avoids a React
// hydration mismatch when the server and client render in different
// timezones.
export function formatDateOnly(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(iso));
}

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

// Binary (1024-based) units, one decimal place below 10 of a unit and a
// whole number at or above it (e.g. "1.5 KB", "42 KB", "3 MB").
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < FILE_SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${FILE_SIZE_UNITS[unitIndex]}`;
}
