import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { loginUrl } from "@/lib/site"

const navLinks = [
  { href: "#board", label: "The board" },
  { href: "#visits", label: "Visits" },
  { href: "#automations", label: "Automations" },
  { href: "#attribution", label: "Attribution" },
]

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-[100] border-b border-line bg-cream/[0.86] backdrop-blur-[10px]">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-6 px-[clamp(24px,4vw,56px)] py-4">
        <a href="#top" className="flex items-baseline gap-3">
          <span className="font-display text-[22px] font-extrabold tracking-[-0.02em]">
            LeadLoop
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-taupe max-[420px]:hidden">
            Leasing OS · MTL
          </span>
        </a>

        <nav className="flex flex-wrap items-center gap-[26px] text-sm text-clay">
          <div className="hidden flex-wrap items-center gap-[26px] md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-clay transition-colors hover:text-ink"
              >
                {link.label}
              </a>
            ))}
          </div>
          <a
            href={loginUrl}
            className="text-clay transition-colors hover:text-ink"
          >
            Sign in
          </a>
          <a
            href="#demo"
            className={cn(buttonVariants({ variant: "primary", size: "sm" }))}
          >
            Book a demo
          </a>
        </nav>
      </div>
    </header>
  )
}
