// Notes vs. Review (issue #13, plan.md §7: "They should be visually
// distinct on the item page"). Independent fields -- each renders under its
// own heading only when its own value is non-null, so an item can show one,
// both, or neither. The two containers are deliberately styled differently
// (Notes: --surface card with a left accent bar, small text -- a working-
// notes feel; Review: a bordered --bg block, larger italicized text -- a
// considered-opinion/quote feel) so the two stay tellable apart even with
// the "Notes"/"Review" headings cropped out of a screenshot.
export function NotesReview({
  notes,
  review,
}: {
  notes: string | null;
  review: string | null;
}) {
  if (!notes && !review) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {notes ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-primary">Notes</h2>
          <div className="whitespace-pre-wrap rounded-md border-l-4 border-l-accent bg-surface p-4 text-sm text-text-primary">
            {notes}
          </div>
        </section>
      ) : null}

      {review ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-primary">Review</h2>
          <div className="whitespace-pre-wrap rounded-md border border-border bg-bg p-4 text-base italic leading-relaxed text-text-primary">
            {review}
          </div>
        </section>
      ) : null}
    </div>
  );
}
