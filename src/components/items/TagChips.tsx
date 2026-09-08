// Tag chips (issue #12): "truncated to one line with a +N overflow
// indicator when they don't fit". A dense list row/card has no reliable way
// to measure pixel-fit without client JS, so this caps at a fixed count
// (deterministic, testable, and reasonable for the compact densities
// ui-style-guide.md §3 calls for) and folds the rest into a "+N" chip.
export function TagChips({
  tags,
  maxVisible = 3,
}: {
  tags: string[];
  maxVisible?: number;
}) {
  if (tags.length === 0) {
    return null;
  }

  const visible = tags.slice(0, maxVisible);
  const overflowCount = tags.length - visible.length;

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      {visible.map((tag) => (
        <span
          key={tag}
          className="inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-text-secondary"
        >
          {tag}
        </span>
      ))}
      {overflowCount > 0 ? (
        <span className="shrink-0 text-xs text-text-secondary">
          +{overflowCount}
        </span>
      ) : null}
    </div>
  );
}
