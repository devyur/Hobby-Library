import * as React from "react"
import { cn } from "cn"

// Native <select> primitive (issue #14) -- no Radix Select is used here.
// This project's other form primitives (Input) are native elements too, and
// a native <select> keeps free keyboard/screen-reader semantics and is what
// both `getByLabelText`/`getByRole("combobox")` and Playwright's
// `selectOption()` drive directly, rather than a custom Radix listbox.
// Styled with the same tokens/shape as Input (border/surface/text/
// focus-ring/aria-invalid) for visual consistency, plus a custom chevron
// since a native <select>'s built-in arrow can't be restyled directly.
function Select({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "h-9 w-full min-w-0 appearance-none rounded-md border border-border bg-surface px-2.5 py-1 pr-8 text-sm text-text-primary shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500 aria-invalid:ring-3 aria-invalid:ring-red-500/20",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-text-secondary"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
      </svg>
    </div>
  )
}

export { Select }
