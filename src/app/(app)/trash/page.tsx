// Trivial stub (issue #10, acceptance criteria C) -- real content
// (restore/permanent delete) is #25's job. Exists so /trash is a real
// route inside the shell rather than a 404.
export default function TrashPage() {
  return (
    <div className="flex flex-1 flex-col gap-2 px-6 py-8">
      <h1 className="text-lg font-semibold text-text-primary">Trash</h1>
      <p className="text-sm text-text-secondary">Trash — coming in #25.</p>
    </div>
  );
}
