import { formatFileSize } from "@/lib/format";
import type { ItemAttachment } from "@/lib/queries/items";

// Attachments section (issue #13, database-schema.md §3 `item_attachments`).
// Same "heading always renders, explicit empty state" treatment as
// ItemLinks. Plain metadata only (filename, human-readable size, type) --
// no download action, that lands in #21.
export function ItemAttachments({ attachments }: { attachments: ItemAttachment[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-text-primary">Attachments</h2>
      {attachments.length === 0 ? (
        <p className="text-sm text-text-secondary">No attachments yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex flex-wrap items-center gap-2 text-sm text-text-primary"
            >
              <span>{attachment.filename}</span>
              <span className="text-text-secondary">
                {formatFileSize(attachment.sizeBytes)} · {attachment.mimeType}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
