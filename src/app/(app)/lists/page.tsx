import { ListsOverview } from "@/components/lists/ListsOverview";
import { getLists } from "@/lib/queries/lists";

// Lists overview page (issue #26), replacing #10's stub. Every list the
// signed-in user owns, each with its own (non-trashed-only) item count --
// ListsOverview.tsx owns Create/Rename/Delete once this server read seeds
// it, same "one server read, client owns the interactive list after that"
// shape as trash/page.tsx + TrashList.tsx.
export default async function ListsPage() {
  const lists = await getLists();

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-8">
      <h1 className="text-lg font-semibold text-text-primary">Custom Lists</h1>
      <ListsOverview initialLists={lists} />
    </div>
  );
}
