import { SeoMarketingPanel } from "./SeoMarketingPanel"
import { createSampleWatchSeoData } from "./sample-data"

const story = { title: "Watch/SEO & Marketing", component: SeoMarketingPanel }
export default story

/** Isolated presentation story. All evidence below is sample data. */
export function SampleEvidence() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <p id="sample-seo-tab" className="mb-6 text-sm text-amber-100">
        Sample evidence only. This is a component story, not live analytics.
      </p>
      <SeoMarketingPanel
        id="sample-seo-panel"
        labelledBy="sample-seo-tab"
        state={{ status: "ready", data: createSampleWatchSeoData() }}
        adminOrigin="https://admin.example.org"
        adminConfirmationUrl="https://admin.example.org/seo/confirm"
      />
    </div>
  )
}
