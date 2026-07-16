import { Badge } from "@/components/ui/badge"
import {
  Container,
  Figcaption,
  Frame,
  SectionEyebrow,
  SectionTitle,
} from "@/components/landing/primitives"

type BadgeVariant = "statusNew" | "statusVisit" | "statusSigned"

const gridCols = "grid-cols-[1.6fr_1.8fr_1fr_1.1fr_1.1fr]"

const groups: {
  name: string
  bar: string
  count: number
  rows: {
    lead: string
    unit: string
    agent: string
    visit: string
    visitClass: string
    status: { variant: BadgeVariant; label: string }
  }[]
}[] = [
  {
    name: "New lead",
    bar: "bg-taupe-3",
    count: 3,
    rows: [
      {
        lead: "Camille Tremblay",
        unit: "3½ — 5510 av. Waverly, #2",
        agent: "S. Pham",
        visit: "—",
        visitClass: "text-taupe-2",
        status: { variant: "statusNew", label: "New" },
      },
      {
        lead: "Nadia Benali",
        unit: "4½ — 5510 av. Waverly, #6",
        agent: "K. Aubé",
        visit: "—",
        visitClass: "text-taupe-2",
        status: { variant: "statusNew", label: "New" },
      },
    ],
  },
  {
    name: "Visit booked",
    bar: "bg-gold",
    count: 2,
    rows: [
      {
        lead: "Étienne Gagnon",
        unit: "3½ — 5510 av. Waverly, #2",
        agent: "S. Pham",
        visit: "Jul 21 · 10:30",
        visitClass: "font-mono text-[11px] text-gold",
        status: { variant: "statusVisit", label: "Visit" },
      },
      {
        lead: "Sofia Almeida",
        unit: "5½ — 74 av. Fairmount O., #3",
        agent: "M.-A. Roy",
        visit: "Jul 22 · 17:00",
        visitClass: "font-mono text-[11px] text-gold",
        status: { variant: "statusVisit", label: "Visit" },
      },
    ],
  },
  {
    name: "Lease signed",
    bar: "bg-forest",
    count: 1,
    rows: [
      {
        lead: "Jade Morin",
        unit: "3½ — 74 av. Fairmount O., #1",
        agent: "S. Pham",
        visit: "Signed Jul 12",
        visitClass: "font-mono text-[11px] text-clay-2",
        status: { variant: "statusSigned", label: "Signed" },
      },
    ],
  },
]

export function BoardSection() {
  return (
    <section
      id="board"
      className="scroll-mt-[72px] border-t border-line"
    >
      <Container className="py-[clamp(56px,7vh,84px)]">
        <SectionEyebrow num="01" label="The board" />
        <SectionTitle className="mb-4 max-w-[20ch]">
          The board is the office.
        </SectionTitle>
        <p className="mb-7 max-w-[62ch] text-[17px] leading-[1.65] text-clay text-pretty">
          The template seeds seven stages — new lead to lease signed. Nineteen
          column types, filters that read{" "}
          <em className="border-b border-forest not-italic text-ink">
            where status is visit booked
          </em>
          , bulk actions, subitems under any lead. The lead column stays frozen
          while the rest scrolls: the row is the record.
        </p>

        <div className="mb-8 flex flex-wrap gap-2.5">
          <Badge variant="spec">Groups are stages</Badge>
          <Badge variant="spec">Rows are leads</Badge>
          <Badge variant="spec">19 column types</Badge>
          <Badge variant="spec">4 views — table · calendar · map · form</Badge>
        </div>

        <figure className="m-0">
          <Frame className="overflow-x-auto">
            <div className="min-w-[680px]">
              {/* Frame header */}
              <div className="flex items-baseline justify-between gap-4 border-b border-line-2 px-5 py-[14px]">
                <span className="text-sm font-semibold">
                  Plateau portfolio — Leasing
                </span>
                <span className="flex gap-[18px] font-mono text-[10px] uppercase tracking-[0.1em]">
                  <span className="border-b-[1.5px] border-forest pb-[3px] text-forest">
                    Table
                  </span>
                  <span className="text-taupe-2">Calendar</span>
                  <span className="text-taupe-2">Map</span>
                  <span className="text-taupe-2">Form</span>
                </span>
              </div>

              {/* Column headers */}
              <div
                className={`grid ${gridCols} border-b border-line-2 px-5 py-[10px] font-mono text-[10px] uppercase tracking-[0.08em] text-taupe-2`}
              >
                <span>Lead</span>
                <span>Unit</span>
                <span>Agent</span>
                <span>Visit</span>
                <span>Status</span>
              </div>

              {/* Groups + rows */}
              {groups.map((group, gi) => (
                <div key={group.name}>
                  <div
                    className={`flex items-center gap-2 px-5 pb-[5px] ${
                      gi === 0 ? "pt-[11px]" : "pt-[14px]"
                    }`}
                  >
                    <span className={`h-[3px] w-4 rounded-[2px] ${group.bar}`} />
                    <span className="text-[13px] font-semibold">
                      {group.name}
                    </span>
                    <span className="font-mono text-[10px] text-taupe-2">
                      {group.count}
                    </span>
                  </div>
                  {group.rows.map((row) => (
                    <div
                      key={row.lead}
                      className={`grid ${gridCols} items-center border-t border-line-3 px-5 py-[10px] text-[13.5px]`}
                    >
                      <span className="font-medium">{row.lead}</span>
                      <span className="text-clay-2">{row.unit}</span>
                      <span className="text-clay-2">{row.agent}</span>
                      <span className={row.visitClass}>{row.visit}</span>
                      <span>
                        <Badge variant={row.status.variant}>
                          {row.status.label}
                        </Badge>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Frame>
          <Figcaption>
            Fig. 1 — Pipeline board, Plateau portfolio. Groups are stages, rows
            are leads.
          </Figcaption>
        </figure>
      </Container>
    </section>
  )
}
