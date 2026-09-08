// Trivial stub (issue #10, acceptance criteria C) -- real content
// (create/rename/delete, add/remove items) is #26's job. Exists so /lists
// is a real route inside the shell rather than a 404.
export default function ListsPage() {
  return (
    <div className="flex flex-1 flex-col gap-2 px-6 py-8">
      <h1 className="text-lg font-semibold text-text-primary">
        Custom Lists
      </h1>
      <p className="text-sm text-text-secondary">
        Custom Lists — coming in #26.
      </p>
    </div>
  );
}
