import { getCategories } from "@/lib/queries/categories";
import { getSubtypes } from "@/lib/queries/subtypes";
import { getTags } from "@/lib/queries/tags";

import { AddItemForm } from "./AddItemForm";

// Full Add form route (issue #14). Signed-in only -- middleware.ts already
// redirects an unauthenticated request to /login before this ever renders.
// Deliberately category-agnostic (not nested under [category]/): the form's
// own Category dropdown is what drives the reactive Subtype filtering the
// issue calls for, so this route can't be pre-scoped to whichever category
// library page the user came from.
//
// categories/subtypes/tags are fetched once here, server-side, and passed
// down as props -- AddItemForm.tsx does all category->subtype filtering
// client-side against this already-fetched data (per the issue's
// constraint against adding a client-side data-fetching layer / cache).
export default async function AddItemPage() {
  const [categories, subtypes, tags] = await Promise.all([
    getCategories(),
    getSubtypes(),
    getTags(),
  ]);

  return <AddItemForm categories={categories} subtypes={subtypes} tags={tags} />;
}
