// Cover thumbnail for Card view (issue #12). An item with no cover image
// renders a defined placeholder -- per ui-direction.md's "should still look
// beautiful without covers" note and ui-style-guide.md §3's explicit
// callout -- rather than a broken/empty box.
//
// Plain <img>, not next/image: the src is a per-request signed URL from the
// private `covers` bucket (a different host/query string every render),
// which doesn't fit next/image's static remotePatterns config cleanly for a
// single-consumer app.
export function CoverThumbnail({
  coverUrl,
  title,
}: {
  coverUrl: string | null;
  title: string;
}) {
  if (!coverUrl) {
    return (
      <div
        role="img"
        aria-label={`No cover image for ${title}`}
        className="flex aspect-2/3 w-full items-center justify-center rounded-md border border-border bg-bg text-text-secondary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="size-8"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="1.5" />
          <path d="M21 15l-5-5-9 9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={coverUrl}
      alt={`Cover for ${title}`}
      className="aspect-2/3 w-full rounded-md border border-border object-cover"
    />
  );
}
