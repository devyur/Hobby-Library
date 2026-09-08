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
