import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// shadcn/ui Button primitive, added via `npx shadcn@latest init -b radix`
// (see components.json) and restyled to consume the design tokens defined
// in globals.css (_docs/ui-style-guide.md §1) instead of shadcn's default
// gray/black oklch palette -- issue #8 acceptance criteria (B): background,
// border, and focus-ring resolve to --accent/--border/--surface.
//
// Only the variants/sizes ThemeToggle.tsx (the one consumer today) actually
// uses are kept -- shadcn's stock secondary/ghost/destructive/link variants
// and xs/lg/icon-* sizes are trimmed rather than speculatively carried
// along; a later task can restore them from the registry if it needs them.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent text-white hover:opacity-90",
        outline:
          "border-border bg-surface text-text-primary hover:bg-bg",
      },
      size: {
        // Mobile-first: 44px tall (WCAG 2.2 SC 2.5.8 / Apple HIG touch-target
        // baseline, issue #31), shrinking back to the original desktop
        // density at md: and up -- same "same components, responsive
        // Tailwind classes" pattern NavShell.tsx already established, not a
        // separate mobile size variant.
        default: "h-11 px-3 md:h-9",
        sm: "h-11 px-2.5 text-[0.8rem] md:h-8",
        icon: "size-11 md:size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
