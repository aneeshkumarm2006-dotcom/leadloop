import * as React from "react"

import { cn } from "@/lib/utils"

/** Page-width wrapper shared by every section. */
export const containerClass = "mx-auto max-w-[1180px] px-[clamp(24px,4vw,56px)]"

export function Container({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn(containerClass, className)} {...props} />
}

/** The numbered "01 · The board" eyebrow that opens each section. */
export function SectionEyebrow({
  num,
  label,
}: {
  num: string
  label: string
}) {
  return (
    <div className="mb-[14px] flex items-baseline gap-3">
      <span className="font-mono text-[12px] tracking-[0.14em] text-forest">
        {num}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-taupe">
        {label}
      </span>
    </div>
  )
}

/** White product-mock card used for every figure. */
export function Frame({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-[16px] border border-line bg-white shadow-[0_24px_60px_-46px_rgba(42,38,32,0.4)]",
        className
      )}
      {...props}
    />
  )
}

/** Monospace caption under a figure. */
export function Figcaption({
  className,
  ...props
}: React.ComponentProps<"figcaption">) {
  return (
    <figcaption
      className={cn("pt-3 font-mono text-[11px] text-taupe", className)}
      {...props}
    />
  )
}

/** Section <h2> in the display typeface. */
export function SectionTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "font-display text-[clamp(30px,4vw,46px)] font-bold leading-[1.05] tracking-[-0.02em] text-balance",
        className
      )}
      {...props}
    />
  )
}
