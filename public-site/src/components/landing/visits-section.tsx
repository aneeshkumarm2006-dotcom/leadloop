import {
  Container,
  Figcaption,
  Frame,
  SectionEyebrow,
  SectionTitle,
} from "@/components/landing/primitives"

const days = [
  { d: "Mon", n: 20 },
  { d: "Tue", n: 21, selected: true },
  { d: "Wed", n: 22 },
  { d: "Thu", n: 23 },
  { d: "Fri", n: 24 },
]

const slots = [
  { t: "09:00" },
  { t: "10:30", selected: true },
  { t: "14:00" },
  { t: "15:30" },
]

const bullets = [
  "Creates the lead",
  "Stamps the date column",
  "Round-robins the agent",
  ".ics to both sides",
]

export function VisitsSection() {
  return (
    <section id="visits" className="scroll-mt-[72px] border-t border-line">
      <Container className="py-[clamp(56px,7vh,84px)]">
        <SectionEyebrow num="03" label="Visits" />
        <SectionTitle className="mb-4 max-w-[20ch]">
          One booking link per building.
        </SectionTitle>
        <p className="mb-8 max-w-[62ch] text-[17px] leading-[1.65] text-clay text-pretty">
          Availability is weekly hours plus exceptions — buffers, a daily cap,
          minimum notice. The slot engine is timezone-aware and survives
          daylight saving. A booking creates the lead, stamps the date, assigns
          the agent round-robin, and mails both sides an .ics with a cancel
          link.
        </p>

        <div className="grid grid-cols-1 items-start gap-[clamp(24px,4vw,44px)] lg:grid-cols-[1.5fr_1fr]">
          <figure className="m-0 min-w-0">
            <Frame className="overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line-2 px-5 py-[14px]">
                <span className="text-sm font-semibold">
                  5510 av. Waverly — Book a visit
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-taupe">
                  July 2026 · America/Montreal · 30 min
                </span>
              </div>

              {/* Day picker */}
              <div className="flex flex-wrap gap-2 px-5 pt-4 pb-1">
                {days.map((day) => (
                  <div
                    key={day.d}
                    className={`rounded-[12px] border px-[14px] py-[9px] text-center ${
                      day.selected
                        ? "border-ink bg-ink text-cream"
                        : "border-line-4"
                    }`}
                  >
                    <span
                      className={`block font-mono text-[9px] uppercase tracking-[0.1em] ${
                        day.selected ? "opacity-70" : "text-taupe"
                      }`}
                    >
                      {day.d}
                    </span>
                    <span className="mt-[2px] block text-[15px] font-semibold">
                      {day.n}
                    </span>
                  </div>
                ))}
              </div>

              {/* Time slots */}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 px-5 pt-3 pb-4">
                {slots.map((slot) => (
                  <span
                    key={slot.t}
                    className={`rounded-[10px] border px-1 py-[10px] text-center font-mono text-[12px] ${
                      slot.selected
                        ? "border-forest bg-forest text-white"
                        : "border-line-4"
                    }`}
                  >
                    {slot.t}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line-2 px-5 py-[14px]">
                <span className="max-w-[44ch] text-[13px] leading-[1.5] text-clay-2">
                  Jul 21 at 10:30 — confirming creates the lead in “Visit
                  booked”, assigns the agent, sends the .ics.
                </span>
                <span className="rounded-full bg-forest px-[18px] py-[11px] text-[13.5px] font-semibold text-white">
                  Confirm the visit
                </span>
              </div>
            </Frame>
            <Figcaption>
              Fig. 2 — Public booking page, /book/waverly-5510. No login,
              visitor&apos;s timezone.
            </Figcaption>
          </figure>

          <div className="flex flex-col gap-4 pt-1.5">
            {bullets.map((bullet) => (
              <div key={bullet} className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-forest" />
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-clay-2">
                  {bullet}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  )
}
