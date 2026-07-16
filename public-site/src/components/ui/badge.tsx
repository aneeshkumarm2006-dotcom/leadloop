import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap rounded-full font-mono uppercase leading-none transition-colors",
  {
    variants: {
      variant: {
        // Hero eyebrow — green tint pill
        eyebrow:
          "border border-mint-border bg-mint px-[13px] py-[6px] text-[11px] tracking-[0.16em] text-forest",
        // Section spec chips ("Groups are stages")
        spec: "border border-line-4 bg-sand px-[13px] py-[7px] text-[10px] tracking-[0.1em] text-clay-2",
        // Board status chips
        statusNew:
          "border border-line-4 px-2 py-[3px] text-[9px] tracking-[0.06em] text-clay-2",
        statusVisit:
          "border border-gold-border bg-gold-bg px-2 py-[3px] text-[9px] tracking-[0.06em] text-gold",
        statusSigned:
          "bg-forest px-2 py-[3px] text-[9px] tracking-[0.06em] text-white",
      },
    },
    defaultVariants: {
      variant: "spec",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
