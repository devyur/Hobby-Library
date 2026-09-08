import * as React from "react"
import { cn } from "cn"

// Native <textarea> primitive (issue #14), styled to match Input/Select's
// tokens (border/surface/text/focus-ring/aria-invalid) -- no new visual
// language, per ui-style-guide.md §1-2.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-20 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary shadow-xs transition-[color,box-shadow] outline-none placeholder:text-text-secondary focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500 aria-invalid:ring-3 aria-invalid:ring-red-500/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
