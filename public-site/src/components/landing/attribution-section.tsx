import {
  Container,
  Figcaption,
  Frame,
  SectionEyebrow,
  SectionTitle,
} from "@/components/landing/primitives"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const rows = [
  {
    source: "Facebook Ads",
    spend: "$1,820",
    leads: "214",
    leases: "19",
    cost: "$96",
    costClass: "text-ink",
  },
  {
    source: "Kijiji",
    spend: "$810",
    leads: "143",
    leases: "11",
    cost: "$74",
    costClass: "text-forest",
  },
  {
    source: "Referral",
    spend: "$0",
    leads: "38",
    leases: "9",
    cost: "—",
    costClass: "text-taupe-2",
  },
]

const headBase =
  "h-auto font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-taupe px-[18px] py-3 align-middle"
const numCell = "font-mono text-[12.5px] text-right px-[18px] py-3"

export function AttributionSection() {
  return (
    <section
      id="attribution"
      className="scroll-mt-[72px] border-t border-line"
    >
      <Container className="py-[clamp(56px,7vh,84px)]">
        <SectionEyebrow num="05" label="Attribution" />
        <SectionTitle className="mb-8 max-w-[22ch]">
          Which ad paid for which lease.
        </SectionTitle>

        <div className="grid grid-cols-1 items-start gap-[clamp(32px,5vw,64px)] lg:grid-cols-[0.9fr_1.1fr]">
          <p className="max-w-[50ch] text-[17px] leading-[1.65] text-clay text-pretty">
            A campaign is a source and a spend. Forms stamp the source on every
            lead they capture, so the report is arithmetic, not archaeology:
            leads, leases and cost per lease, by source. Dashboards are chart
            widgets over any board — funnel, bar, line, number — with per-widget
            visibility when a number is for admins only.
          </p>

          <figure className="m-0 min-w-0">
            <Frame className="overflow-hidden">
              <Table className="min-w-[420px] border-collapse text-[13.5px]">
                <TableHeader>
                  <TableRow className="border-line-2 hover:bg-transparent">
                    <TableHead className={`${headBase} text-left`}>
                      Source
                    </TableHead>
                    <TableHead className={`${headBase} text-right`}>
                      Spend
                    </TableHead>
                    <TableHead className={`${headBase} text-right`}>
                      Leads
                    </TableHead>
                    <TableHead className={`${headBase} text-right`}>
                      Leases
                    </TableHead>
                    <TableHead className={`${headBase} text-right`}>
                      Cost / lease
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.source}
                      className="border-line-3 hover:bg-transparent"
                    >
                      <TableCell className="px-[18px] py-3">
                        {row.source}
                      </TableCell>
                      <TableCell className={`${numCell} text-clay-2`}>
                        {row.spend}
                      </TableCell>
                      <TableCell className={numCell}>{row.leads}</TableCell>
                      <TableCell className={numCell}>{row.leases}</TableCell>
                      <TableCell className={`${numCell} ${row.costClass}`}>
                        {row.cost}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Frame>
            <Figcaption>
              Fig. 5 — Campaign report, June–July. Referrals are free; the report
              says so.
            </Figcaption>
          </figure>
        </div>
      </Container>
    </section>
  )
}
