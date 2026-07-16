import type { ReactNode } from "react"

import {
  Container,
  Figcaption,
  Frame,
  SectionEyebrow,
  SectionTitle,
} from "@/components/landing/primitives"

const underlineGold = "border-b border-gold not-italic"

const cells: { kind: string; body: ReactNode }[] = [
  {
    kind: "When",
    body: (
      <>
        Status becomes <em className={underlineGold}>Visit booked</em>
      </>
    ),
  },
  { kind: "If", body: "The visit date is set" },
  {
    kind: "Then",
    body: "Send the confirmation SMS and create the calendar event",
  },
  { kind: "When", body: "A day passes after the visit" },
  {
    kind: "If",
    body: (
      <>
        Status is still <em className={underlineGold}>Visit booked</em>
      </>
    ),
  },
  {
    kind: "Then",
    body: "Email “How was the visit?” and enroll in the follow-up sequence",
  },
]

export function AutomationsSection() {
  return (
    <section
      id="automations"
      className="scroll-mt-[72px] border-t border-line bg-sand"
    >
      <Container className="py-[clamp(56px,7vh,84px)]">
        <SectionEyebrow num="04" label="Automations" />
        <SectionTitle className="mb-4 max-w-[26ch]">
          When, if, then. Fourteen triggers, fifteen actions.
        </SectionTitle>
        <p className="mb-8 max-w-[62ch] text-[17px] leading-[1.65] text-clay text-pretty">
          Rules read the way you would say them. Describe one in a sentence and
          the AI drafts it. Every run is logged, and a health page tells you a
          rule broke before an agent does.
        </p>

        <figure className="m-0 mb-10">
          <Frame className="overflow-hidden">
            <div className="grid grid-cols-3 gap-px bg-line-2">
              {cells.map((cell, i) => (
                <div key={i} className="bg-white px-5 py-[18px]">
                  <b className="mb-2 block font-mono text-[9px] uppercase tracking-[0.14em] text-forest">
                    {cell.kind}
                  </b>
                  <p className="text-[13.5px] leading-[1.5]">{cell.body}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-between gap-4 border-t border-line-2 px-5 py-3">
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-taupe">
                Drafted from a sentence · Every run logged
              </span>
              <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-clay-2">
                <span className="h-[7px] w-[7px] rounded-full bg-forest" />
                Run № 8412 — SMS sent · OK
              </span>
            </div>
          </Frame>
          <Figcaption>
            Fig. 3 — Two rules from the starter template. Conditions combine with
            and/or.
          </Figcaption>
        </figure>

        <div className="grid grid-cols-1 items-start gap-[clamp(32px,5vw,64px)] lg:grid-cols-2">
          <div>
            <h3 className="mb-3 font-display text-[22px] font-bold leading-[1.25] tracking-[-0.01em]">
              The message is part of the record
            </h3>
            <p className="mb-4 max-w-[50ch] text-base leading-[1.65] text-clay text-pretty">
              Email — Gmail, Microsoft or IMAP — plus SMS and WhatsApp, sent and
              received inside the lead. Nothing lives in an agent&apos;s personal
              inbox. Follow-ups are sequences: steps and delays, enrolled by hand
              or by rule.
            </p>
            <p className="max-w-[50ch] text-base leading-[1.65] text-clay text-pretty">
              When an agent leaves, their pipeline stays. The next person reads
              the thread and picks up mid-sentence.
            </p>
          </div>

          <figure className="m-0 min-w-0">
            <Frame className="overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line-2 px-5 py-[14px]">
                <span className="text-sm font-semibold">
                  Camille Tremblay — 3½, Waverly
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-taupe">
                  Lead № 2841
                </span>
              </div>
              <div className="flex gap-5 border-b border-line-2 px-5 pt-3 font-mono text-[10px] uppercase tracking-[0.08em]">
                <span className="border-b-[1.5px] border-forest pb-2 text-ink">
                  Updates
                </span>
                <span className="pb-2 text-taupe-2">Email</span>
                <span className="pb-2 text-taupe-2">SMS</span>
                <span className="pb-2 text-taupe-2">WhatsApp</span>
              </div>
              <div className="border-t border-line-3 px-5 py-3">
                <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.08em] text-taupe">
                  M.-A. Roy · Jul 18 · 09:14
                </span>
                <span className="block text-[13.5px] leading-[1.55]">
                  Visited at 10:30 — she wants the 4½ on the third floor. Sending
                  the application tonight.
                </span>
              </div>
              <div className="border-t border-line-3 px-5 py-3">
                <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.08em] text-taupe">
                  Automation · Jul 18 · 09:15
                </span>
                <span className="block text-[13.5px] leading-[1.55]">
                  Moved to “Application” when the checkbox “Application sent” was
                  checked.
                </span>
              </div>
            </Frame>
            <Figcaption>
              Fig. 4 — A lead&apos;s record. Every channel threads onto the same
              row.
            </Figcaption>
          </figure>
        </div>
      </Container>
    </section>
  )
}
