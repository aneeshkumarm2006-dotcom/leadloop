import * as React from "react"

import { SiteFooter } from "@/components/landing/site-footer"
import { SiteHeader } from "@/components/landing/site-header"
import { containerClass } from "@/components/landing/primitives"
import { cn } from "@/lib/utils"

/** Shared contact + dates for every legal page. Change them here only. */
export const LEGAL = {
  company: "LeadLoop",
  location: "Montréal, Québec, Canada",
  email: "hello@leadloop.ca",
  effective: "November 20, 2026",
}

const prose = cn(
  "max-w-[760px] text-[15.5px] leading-[1.7] text-clay",
  "[&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:scroll-mt-24 [&_h2]:font-display [&_h2]:text-[24px] [&_h2]:font-bold [&_h2]:tracking-[-0.01em] [&_h2]:text-ink",
  "[&_h3]:mt-7 [&_h3]:mb-2 [&_h3]:font-display [&_h3]:text-[17px] [&_h3]:font-bold [&_h3]:text-ink",
  "[&_p]:my-3 [&_strong]:text-ink",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6",
  "[&_a]:text-forest [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-forest-deep",
  "[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[14px]",
  "[&_th]:border-b [&_th]:border-line [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-semibold [&_th]:text-ink",
  "[&_td]:border-b [&_td]:border-line-2 [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top"
)

export function LegalPage({
  eyebrow,
  title,
  intro,
  toc,
  children,
}: {
  eyebrow: string
  title: string
  intro: React.ReactNode
  toc?: { id: string; label: string }[]
  children: React.ReactNode
}) {
  return (
    <>
      <SiteHeader />
      <main id="top" className="bg-cream">
        <div className={cn(containerClass, "pt-14 pb-24")}>
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-forest">
            {eyebrow}
          </p>
          <h1 className="max-w-[760px] font-display text-[clamp(34px,5vw,52px)] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink">
            {title}
          </h1>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.1em] text-taupe">
            Effective {LEGAL.effective}
          </p>
          <div className="mt-6 max-w-[760px] text-[17px] leading-[1.6] text-clay">
            {intro}
          </div>

          {toc && toc.length > 0 ? (
            <nav
              aria-label="On this page"
              className="mt-8 max-w-[760px] rounded-[14px] border border-line bg-sand p-5"
            >
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-taupe">
                On this page
              </p>
              <ol className="grid gap-x-6 gap-y-1.5 text-[14px] sm:grid-cols-2">
                {toc.map((item, i) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="text-clay transition-colors hover:text-forest"
                    >
                      {i + 1}. {item.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}

          <article className={cn(prose, "mt-4")}>{children}</article>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
