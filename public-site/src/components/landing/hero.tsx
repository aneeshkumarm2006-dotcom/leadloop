import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Frame } from "@/components/landing/primitives"
import { cn } from "@/lib/utils"

export function Hero() {
  return (
    <section className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-[clamp(32px,5vw,64px)] px-[clamp(24px,4vw,56px)] pt-[clamp(56px,8vh,92px)] pb-[68px] md:grid-cols-[1.05fr_0.95fr]">
      {/* Copy */}
      <div className="ll-rise">
        <Badge variant="eyebrow">Board-based leasing CRM · EN + FR</Badge>
        <h1 className="mt-[22px] mb-5 font-display text-[clamp(48px,6.6vw,74px)] font-bold leading-[0.98] tracking-[-0.03em] text-balance">
          Leads in.
          <br />
          <span className="text-forest">Leases out.</span>
        </h1>
        <p className="mb-[30px] max-w-[48ch] text-[19px] leading-[1.55] text-clay text-pretty">
          Run a whole leasing operation as one board. Stages are groups, leads
          are rows, and every visit, message and signature lands on the same
          line — built in Montréal, in both languages.
        </p>
        <div className="flex flex-wrap items-center gap-5">
          <a
            href="#demo"
            className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
          >
            Book a demo
          </a>
          <a
            href="#board"
            className="border-b-2 border-[#d8cdb8] pb-[3px] text-base font-semibold text-ink transition-colors hover:border-forest"
          >
            See the board ↓
          </a>
        </div>
      </div>

      {/* Board preview */}
      <Frame className="overflow-hidden shadow-[0_24px_60px_-40px_rgba(42,38,32,0.5)] ll-rise-delayed">
        <div className="flex items-center justify-between border-b border-line-2 px-[18px] py-[14px]">
          <span className="text-sm font-semibold">Plateau portfolio</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-taupe">
            Table · Calendar · Map · Form
          </span>
        </div>

        <div className="py-2">
          {/* Visit booked group */}
          <div className="flex items-center gap-2 px-[18px] pt-[10px] pb-[6px]">
            <span className="h-[3px] w-4 rounded-[2px] bg-taupe-3" />
            <span className="text-[13px] font-semibold">Visit booked</span>
            <span className="font-mono text-[10px] text-taupe-2">2</span>
          </div>
          <div className="flex items-center justify-between border-t border-line-3 px-[18px] py-[9px] text-[13.5px]">
            <span className="font-medium">Étienne Gagnon</span>
            <span className="font-mono text-[11px] text-gold">Jul 21 · 10:30</span>
          </div>
          <div className="flex items-center justify-between border-t border-line-3 px-[18px] py-[9px] text-[13.5px]">
            <span className="font-medium">Sofia Almeida</span>
            <span className="font-mono text-[11px] text-gold">Jul 22 · 17:00</span>
          </div>

          {/* Lease signed group */}
          <div className="flex items-center gap-2 px-[18px] pt-[14px] pb-[6px]">
            <span className="h-[3px] w-4 rounded-[2px] bg-forest" />
            <span className="text-[13px] font-semibold">Lease signed</span>
            <span className="font-mono text-[10px] text-taupe-2">1</span>
          </div>
          <div className="flex items-center justify-between border-t border-line-3 px-[18px] py-[9px] text-[13.5px]">
            <span className="font-medium">Jade Morin</span>
            <Badge variant="statusSigned">Signed</Badge>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-line-2 px-[18px] py-3 font-mono text-[10px] uppercase tracking-[0.06em] text-taupe">
          <span className="flex h-[7px] w-[130px] overflow-hidden rounded-full">
            <span className="w-[42%] bg-[#d9d0be]" />
            <span className="w-[32%] bg-gold" />
            <span className="w-[26%] bg-forest" />
          </span>
          <span>61 leads · 4 signed</span>
        </div>
      </Frame>
    </section>
  )
}
