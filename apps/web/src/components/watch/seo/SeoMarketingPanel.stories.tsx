import { SeoMarketingPanel } from "./SeoMarketingPanel"
import type {
  AiTrafficEvidence,
  EvidenceFamily,
  WatchSeoMarketingData,
} from "./types"

const reportingWindow = { start: "2026-09-18", end: "2026-10-15" }
export function evidence<T>(
  data: T | null,
  state: EvidenceFamily<T>["state"] = "available",
): EvidenceFamily<T> {
  return {
    state,
    source: "Sample stored observation",
    window: reportingWindow,
    observedAt: "2026-10-16T12:00:00Z",
    data,
  }
}

// Sample fixtures only; production components never provide fallback metrics.
export function createSampleWatchSeoData(): WatchSeoMarketingData {
  return {
    schemaVersion: "watch-seo-marketing-v1",
    page: {
      videoId: "sample-video",
      dubId: "sample-dub",
      language: "English",
      title: "Sample video",
      canonicalUrl: "https://www.jesusfilm.org/watch/sample.html",
      contextualUrl: null,
    },
    rankings: evidence({
      averagePosition: 4.5,
      clicks: 0,
      impressions: null,
      ctrPercent: null,
      comparisonWindow: { start: "2026-08-21", end: "2026-09-17" },
      points: [
        { date: "2026-10-01", position: 8 },
        { date: "2026-10-02", position: null },
        { date: "2026-10-03", position: 3 },
      ],
    }),
    reach: evidence(
      {
        pageViews: 0,
        visitors: null,
        searchClicks: null,
        searchImpressions: null,
        videoSearchClicks: null,
        videoSearchImpressions: null,
      },
      "partial",
    ),
    viewing: evidence({
      starts: 120,
      completions: 30,
      completionRatePercent: 25,
      averageWatchedPercent: 48,
      retention: [
        { percentWatched: 25, viewers: 90, percentOfStarts: 75 },
        { percentWatched: 50, viewers: null, percentOfStarts: null },
      ],
    }),
    ctaOutcomes: evidence({
      items: [
        {
          id: "download",
          label: "Download video",
          clicks: 0,
          outcomes: null,
          outcomeLabel: "Completed downloads",
          denominator: 120,
          attributionNote: "Clicks do not prove a completed download.",
        },
      ],
    }),
    aiTraffic: evidence<AiTrafficEvidence>(null, "not_connected"),
    content: evidence({
      title: "Sample video",
      description: "A sample description.",
      canonicalUrl: "https://www.jesusfilm.org/watch/sample.html",
      checks: [
        { label: "Page title", detail: "A title is present.", state: "pass" },
      ],
    }),
    crawler: evidence(
      {
        renderingMode: "direct_http",
        textExcerpt: "Sample visible page text",
        botVisits: null,
        lastVisitAt: null,
        cacheStatus: "Not observed",
        indexingStatus: "Not verified",
        notes: ["An HTTP response does not prove search indexing."],
      },
      "stale",
    ),
    previews: evidence({
      canonicalUrl: "https://www.jesusfilm.org/watch/sample.html",
      title: "Sample video",
      description: "A sample description.",
      imageUrl: null,
      imageAlt: null,
    }),
    opportunities: evidence({
      items: [
        {
          proposalId: "sample/proposal",
          version: 2,
          payloadDigest: "sample-digest+v2",
          title: "Explain the download action",
          evidence:
            "Visitors clicked download, but completion was not measured.",
          expectedImpact: "Make the next step easier to understand.",
          confidence: "Medium",
          actionSummary: "Create an editorial draft for the button label.",
          applyOutcome: "Creates a draft for review.",
          declineOutcome: "Records this proposal as declined.",
          decisionState: "current",
          ctaEvidence: [
            evidence({
              id: "download",
              label: "Download video",
              clicks: 0,
              outcomes: null,
              outcomeLabel: "Completed downloads",
              denominator: 120,
              attributionNote: "Completion is not measured.",
            }),
          ],
        },
      ],
    }),
    alerts: [
      {
        id: "coverage",
        severity: "warning",
        title: "Some evidence is missing",
        detail: "Download completion is not connected.",
      },
    ],
  }
}

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
