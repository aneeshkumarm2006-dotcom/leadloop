import { DemoForm } from "@/components/landing/demo-form"

export function DemoSection() {
  return (
    <section
      id="demo"
      className="scroll-mt-[72px] bg-forest text-[#f1f5ee]"
    >
      <div className="mx-auto max-w-[1180px] px-[clamp(24px,4vw,56px)] py-[clamp(64px,9vh,104px)] text-center">
        <span className="block font-mono text-[11px] uppercase tracking-[0.16em] text-[#b7cdb2]">
          07 · The demo
        </span>
        <h2 className="mx-auto mt-[18px] mb-[18px] max-w-[16ch] font-display text-[clamp(38px,6vw,60px)] font-extrabold leading-none tracking-[-0.025em] text-balance">
          Thirty minutes. Your buildings.
        </h2>
        <p className="mx-auto mb-8 max-w-[54ch] text-[18px] leading-[1.55] text-[#cbdbc7] text-pretty">
          A demo is not a tour. Bring the building list: we seed your pipeline,
          wire one booking link, and switch on both languages. You leave with
          the working thing.
        </p>
        <div className="mb-6">
          <DemoForm />
        </div>
        <div className="mb-6 text-[15px] text-[#cbdbc7]">
          Prefer email?{" "}
          <a
            href="mailto:hello@leadloop.ca"
            className="border-b-[1.5px] border-[#f1f5ee]/40 pb-[2px] font-semibold text-[#f1f5ee] transition-colors hover:border-white hover:text-white"
          >
            hello@leadloop.ca
          </a>
        </div>
        <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-[#a6bfa1]">
          Single tenant · One instance per company · No trial to expire · Google
          sign-in
        </span>
      </div>
    </section>
  )
}
