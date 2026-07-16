const stages = [
  "New lead",
  "Contacted",
  "Visit booked",
  "Application",
  "Lease to sign",
]

export function PipelineStrip() {
  return (
    <section className="border-y border-line bg-sand">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 overflow-x-auto px-[clamp(24px,4vw,56px)] py-[22px]">
        {stages.map((stage) => (
          <div key={stage} className="flex flex-1 items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] whitespace-nowrap text-clay-2">
              {stage}
            </span>
            <i className="h-px min-w-[20px] flex-1 bg-line-4" />
          </div>
        ))}
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] whitespace-nowrap text-forest">
          ■ Lease signed
        </span>
      </div>
    </section>
  )
}
