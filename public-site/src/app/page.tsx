import { AttributionSection } from "@/components/landing/attribution-section"
import { AutomationsSection } from "@/components/landing/automations-section"
import { BoardSection } from "@/components/landing/board-section"
import { BuiltWithoutSection } from "@/components/landing/built-without-section"
import { DemoSection } from "@/components/landing/demo-section"
import { Hero } from "@/components/landing/hero"
import { IdeaSection } from "@/components/landing/idea-section"
import { PipelineStrip } from "@/components/landing/pipeline-strip"
import { SiteFooter } from "@/components/landing/site-footer"
import { SiteHeader } from "@/components/landing/site-header"
import { VisitsSection } from "@/components/landing/visits-section"

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="top">
        <Hero />
        <PipelineStrip />
        <BoardSection />
        <IdeaSection />
        <VisitsSection />
        <AutomationsSection />
        <AttributionSection />
        <BuiltWithoutSection />
        <DemoSection />
      </main>
      <SiteFooter />
    </>
  )
}
