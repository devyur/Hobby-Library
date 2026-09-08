import { getCategories } from "@/lib/queries/categories";

import { QuickAddForm } from "./QuickAddForm";

// Quick Add route (issue #15). Signed-in only -- middleware.ts already
// redirects an unauthenticated request to /login before this ever renders.
// Separate from Full Add (src/app/(app)/add/) -- no modal primitive exists
// in src/components/ui/ yet, and this is deliberately a minimal two-field
// page + client form + Server Action, not a compact mode of AddItemForm.
//
// The optional ?category=<slug> query param preselects that category in
// the form when it matches an existing category (e.g. arriving from
// LibraryView.tsx's "Quick Add" link) -- an unrecognized/absent slug just
// leaves the Category dropdown unselected, same as Full Add's own default.
export default async function QuickAddPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const [categories, { category: categorySlug }] = await Promise.all([
    getCategories(),
    searchParams,
  ]);

  const initialCategoryId =
    categories.find((category) => category.slug === categorySlug)?.id ?? "";

  return <QuickAddForm categories={categories} initialCategoryId={initialCategoryId} />;
}
