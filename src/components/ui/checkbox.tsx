import * as React from "react"
import { cn } from "cn"

// Native checkbox primitive (issue #14), used as the building block for the
// Full Add form's tag multi-select (a plain checkbox group, per the issue's
// scope decisions -- not a combobox/listbox). `accent-accent` (Tailwind's
// `accent-color` utility) recolors the native check to the --accent token
// instead of shadcn's default gray/oklch, matching the precedent set by
// button.tsx/input.tsx of consuming this project's own tokens.
function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-4 shrink-0 rounded border border-border bg-surface accent-accent outline-none focus-visible:ring-3 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Checkbox }
