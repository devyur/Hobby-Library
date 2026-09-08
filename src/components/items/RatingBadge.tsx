// Rating badge (issue #12, per ui-style-guide.md §1's "Rating badge"
// decision): neutral pill, format "X/10", omitted entirely (not "0/10")
// when rating is null. Uses the `rating-badge` utility already defined in
// globals.css.
export function RatingBadge({ rating }: { rating: number | null }) {
  if (rating === null) {
    return null;
  }

  return <span className="rating-badge">{rating}/10</span>;
}
