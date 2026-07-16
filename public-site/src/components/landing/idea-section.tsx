import {
  Container,
  SectionEyebrow,
  SectionTitle,
} from "@/components/landing/primitives"

const rows = [
  ["The pipeline", "A board — stages are groups, leads are rows"],
  ["A lead's fields", "Columns — nineteen types, each with its own filters"],
  ["The inventory", "A second board — buildings are groups, units are rows"],
  ["Lead capture", "A public form per board, at /f/your-building"],
  ["Ways of looking", "Saved views — table, calendar, map, form"],
  ["A unit on a lead", "A connection between boards, mirrored both ways"],
]

export function IdeaSection() {
  return (
    <section
      id="idea"
      className="scroll-mt-[72px] border-t border-line bg-sand"
    >
      <Container className="py-[clamp(56px,7vh,84px)]">
        <SectionEyebrow num="02" label="The idea" />
        <SectionTitle className="mb-8 max-w-[24ch]">
          Everything is a board. That is the whole trick.
        </SectionTitle>

        <div className="grid grid-cols-1 items-start gap-[clamp(32px,5vw,64px)] lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            {rows.map(([term, desc], i) => (
              <div
                key={term}
                className={`grid grid-cols-[minmax(130px,1fr)_2fr] gap-x-5 border-t border-line py-[14px] ${
                  i === rows.length - 1 ? "border-b" : ""
                }`}
              >
                <span className="text-[15px] font-semibold">{term}</span>
                <span className="text-[14.5px] text-clay-2">{desc}</span>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-6 max-w-[48ch] text-[17px] leading-[1.65] text-clay text-pretty">
              Because everything is the same shape, nothing is special-cased.
              Columns, filters, forms, automations and permissions work on the
              inventory exactly the way they work on leads.
            </p>
            <p className="max-w-[22ch] font-display text-[clamp(21px,2.4vw,27px)] font-bold leading-[1.25] tracking-[-0.01em] text-forest text-balance">
              Learn the board once and you have learned the product.
            </p>
            <p className="mt-[14px] text-[14.5px] text-clay-2">
              Agents are moving leads the first morning.
            </p>
          </div>
        </div>
      </Container>
    </section>
  )
}
