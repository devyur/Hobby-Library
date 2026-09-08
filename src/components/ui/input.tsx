import * as React from "react"
import { cn } from "cn"

// shadcn/ui Input primitive, added via `npx shadcn@latest add input` (see
// components.json) and restyled to consume the design tokens defined in
// globals.css (_docs/ui-style-guide.md §1) instead of shadcn's default
// gray/oklch palette -- same precedent as button.tsx (#8): background,
// border, and text resolve to --surface/--border/--text-primary. The
// `aria-invalid` state uses Tailwind's built-in red palette rather than a
// `--destructive` token, since ui-style-guide.md defines no such token and
// adding one is outside this issue's (#9) file-touch constraints (no
// globals.css edits).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-text-primary shadow-xs transition-[color,box-shadow] outline-none placeholder:text-text-secondary focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500 aria-invalid:ring-3 aria-invalid:ring-red-500/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
