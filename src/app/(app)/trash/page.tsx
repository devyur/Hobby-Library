import { TrashList } from "@/components/items/TrashList";
import { getTrashedItems } from "@/lib/queries/trash";

// Trash page (issue #25), replacing #10's stub. Cross-category by design
// (getTrashedItems is not scoped to a single category, unlike
// [category]/page.tsx) -- lists every one of the signed-in user's
// soft-deleted items, most-recently-deleted first. No search/filter/sort
// controls (the issue's own "keep it simple" scope) -- TrashList.tsx owns
// Restore/Permanent Delete once this server read seeds it.
export default async function TrashPage() {
  const items = await getTrashedItems();

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-8">
      <h1 className="text-lg font-semibold text-text-primary">Trash</h1>
      <TrashList initialItems={items} />
    </div>
  );
}
