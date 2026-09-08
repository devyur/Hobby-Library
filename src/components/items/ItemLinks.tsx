import type { ItemLink } from "@/lib/queries/items";

// Links section (issue #13, database-schema.md §3 `item_links`). Unlike
// Tags (which collapses entirely when empty), this heading always renders
// -- Links is a named structural field per plan.md §10, worth signposting
// even before #20 ships the creation UI that would ever populate it.
export function ItemLinks({ links }: { links: ItemLink[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-text-primary">Links</h2>
      {links.length === 0 ? (
        <p className="text-sm text-text-secondary">No links yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.id}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline"
              >
                {link.label || link.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
