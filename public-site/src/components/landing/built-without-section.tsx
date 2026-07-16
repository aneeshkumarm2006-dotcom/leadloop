import {
  Container,
  SectionEyebrow,
  SectionTitle,
} from "@/components/landing/primitives"
import { Card } from "@/components/ui/card"

const cards = [
  {
    n: "№1",
    title: "Rent collection",
    body: "LeadLoop stops at the signed lease; payments and accounting belong to tools built for them.",
  },
  {
    n: "№2",
    title: "Plans and tiers",
    body: "One instance per company with everything on — nothing is designed to sell you an upgrade.",
  },
  {
    n: "№3",
    title: "Gantt and workload",
    body: "Only the four views a leasing team opens: table, calendar, map, form.",
  },
  {
    n: "№4",
    title: "Commission math",
    body: "Dashboards show activity, not payroll. Compensation stays between you and your agents.",
  },
]

export function BuiltWithoutSection() {
  return (
    <section
      id="without"
      className="scroll-mt-[72px] border-t border-line bg-sand"
    >
      <Container className="py-[clamp(56px,7vh,84px)]">
        <SectionEyebrow num="06" label="Built without" />
        <SectionTitle className="mb-8 max-w-[20ch]">
          What we refused to build.
        </SectionTitle>

        <div className="grid grid-cols-2 gap-[18px] lg:grid-cols-4">
          {cards.map((card) => (
            <Card
              key={card.n}
              className="gap-0 rounded-[16px] border border-line bg-white p-6 shadow-none ring-0"
            >
              <span className="font-mono text-[10px] tracking-[0.12em] text-taupe-2">
                {card.n}
              </span>
              <h3 className="mt-[10px] mb-2 font-display text-[19px] font-bold tracking-[-0.01em]">
                <s className="line-through decoration-forest decoration-2">
                  {card.title}
                </s>
              </h3>
              <p className="text-[14px] leading-[1.6] text-clay-2">
                {card.body}
              </p>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  )
}
