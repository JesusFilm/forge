import type {
  AiTrafficEvidence,
  EvidenceFamily,
  WatchSeoMarketingData,
} from "./types"

const reportingWindow = { start: "2026-09-18", end: "2026-10-15" }

export function sampleEvidence<T>(
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

/** Development preview fixture. It is never used by the production data path. */
export function createDevelopmentPreviewWatchSeoData({
  videoSlug = "sample",
  languageSlug = "english",
}: {
  videoSlug?: string
  languageSlug?: string
} = {}): WatchSeoMarketingData {
  const title = videoSlug
    .split("-")
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ")
  const canonicalUrl = `https://www.jesusfilm.org/watch/${videoSlug}.html`

  return {
    schemaVersion: "watch-seo-marketing-v1",
    page: {
      videoId: `preview-${videoSlug}`,
      dubId: `preview-${languageSlug}`,
      language: languageSlug,
      title: title || "Sample video",
      canonicalUrl,
      contextualUrl: null,
    },
    rankings: sampleEvidence({
      averagePosition: 4.5,
      clicks: 386,
      impressions: 12_840,
      ctrPercent: 3.01,
      comparisonWindow: { start: "2026-08-21", end: "2026-09-17" },
      points: [
        { date: "2026-10-01", position: 8 },
        { date: "2026-10-05", position: 6.4 },
        { date: "2026-10-10", position: 5.2 },
        { date: "2026-10-15", position: 4.5 },
      ],
    }),
    reach: sampleEvidence(
      {
        pageViews: 8_421,
        visitors: 6_908,
        searchClicks: 386,
        searchImpressions: 12_840,
        videoSearchClicks: 112,
        videoSearchImpressions: 3_970,
      },
      "partial",
    ),
    viewing: sampleEvidence({
      starts: 5_216,
      completions: 1_304,
      completionRatePercent: 25,
      averageWatchedPercent: 48,
      retention: [
        { percentWatched: 25, viewers: 3_912, percentOfStarts: 75 },
        { percentWatched: 50, viewers: 2_504, percentOfStarts: 48 },
        { percentWatched: 75, viewers: 1_721, percentOfStarts: 33 },
        { percentWatched: 100, viewers: 1_304, percentOfStarts: 25 },
      ],
    }),
    ctaOutcomes: sampleEvidence({
      items: [
        {
          id: "download",
          label: "Download video",
          clicks: 284,
          outcomes: 173,
          outcomeLabel: "Completed downloads",
          denominator: 284,
          attributionNote:
            "Completed downloads attributed after a download-button click.",
        },
      ],
    }),
    aiTraffic: sampleEvidence<AiTrafficEvidence>(
      {
        visits: 94,
        assistants: [
          { name: "ChatGPT", visits: 52 },
          { name: "Perplexity", visits: 28 },
          { name: "Other assistants", visits: 14 },
        ],
      },
      "partial",
    ),
    content: sampleEvidence({
      title: title || "Sample video",
      description:
        "Watch the story of Jesus through this full-length film and explore related resources.",
      canonicalUrl,
      checks: [
        {
          label: "Page title",
          detail: "A unique title is present.",
          state: "pass",
        },
        {
          label: "Description",
          detail: "The description explains the page clearly.",
          state: "pass",
        },
        {
          label: "Transcript coverage",
          detail:
            "Only part of the spoken content is represented as crawlable text.",
          state: "warning",
        },
      ],
    }),
    crawler: sampleEvidence(
      {
        renderingMode: "direct_http",
        textExcerpt:
          "Watch the story of Jesus and discover related videos and resources.",
        botVisits: 1_184,
        lastVisitAt: "2026-10-16T08:42:00Z",
        cacheStatus: "Fresh at last observation",
        indexingStatus: "Indexed",
        notes: [
          "Crawler observations do not guarantee current search indexing.",
        ],
      },
      "stale",
    ),
    previews: sampleEvidence({
      canonicalUrl,
      title: title || "Sample video",
      description:
        "Watch the story of Jesus through this full-length film and explore related resources.",
      imageUrl: null,
      imageAlt: null,
    }),
    opportunities: sampleEvidence({
      items: [
        {
          proposalId: "preview/transcript-coverage",
          version: 1,
          payloadDigest: "preview-only",
          title: "Expand the crawlable transcript",
          evidence:
            "The video retains viewers, but only part of its spoken content is available to search crawlers.",
          expectedImpact:
            "Help search engines and AI assistants understand more of the film.",
          confidence: "Medium",
          actionSummary:
            "Create a transcript expansion draft for editorial review.",
          applyOutcome: "Creates a draft; it does not publish the page.",
          declineOutcome: "Records that this preview proposal was declined.",
          decisionState: "current",
          ctaEvidence: [],
        },
      ],
    }),
    alerts: [
      {
        id: "preview-data",
        severity: "info",
        title: "Local preview data",
        detail:
          "These illustrative values let you review the interface. They are not live analytics.",
      },
      {
        id: "transcript-coverage",
        severity: "warning",
        title: "Transcript coverage could be improved",
        detail:
          "Some spoken content is not represented in the crawlable page text.",
      },
    ],
  }
}

/** Sparse fixture used by presentation stories and contract-focused tests. */
export function createSampleWatchSeoData(): WatchSeoMarketingData {
  const data = createDevelopmentPreviewWatchSeoData()
  data.page = {
    videoId: "sample-video",
    dubId: "sample-dub",
    language: "English",
    title: "Sample video",
    canonicalUrl: "https://www.jesusfilm.org/watch/sample.html",
    contextualUrl: null,
  }
  data.rankings = sampleEvidence({
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
  })
  data.reach = sampleEvidence(
    {
      pageViews: 0,
      visitors: null,
      searchClicks: null,
      searchImpressions: null,
      videoSearchClicks: null,
      videoSearchImpressions: null,
    },
    "partial",
  )
  data.viewing = sampleEvidence({
    starts: 120,
    completions: 30,
    completionRatePercent: 25,
    averageWatchedPercent: 48,
    retention: [
      { percentWatched: 25, viewers: 90, percentOfStarts: 75 },
      { percentWatched: 50, viewers: null, percentOfStarts: null },
    ],
  })
  data.ctaOutcomes = sampleEvidence({
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
  })
  data.aiTraffic = sampleEvidence<AiTrafficEvidence>(null, "not_connected")
  data.content = sampleEvidence({
    title: "Sample video",
    description: "A sample description.",
    canonicalUrl: "https://www.jesusfilm.org/watch/sample.html",
    checks: [
      { label: "Page title", detail: "A title is present.", state: "pass" },
    ],
  })
  data.crawler = sampleEvidence(
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
  )
  data.previews = sampleEvidence({
    canonicalUrl: "https://www.jesusfilm.org/watch/sample.html",
    title: "Sample video",
    description: "A sample description.",
    imageUrl: null,
    imageAlt: null,
  })
  data.opportunities = sampleEvidence({
    items: [
      {
        proposalId: "sample/proposal",
        version: 2,
        payloadDigest: "sample-digest+v2",
        title: "Explain the download action",
        evidence: "Visitors clicked download, but completion was not measured.",
        expectedImpact: "Make the next step easier to understand.",
        confidence: "Medium",
        actionSummary: "Create an editorial draft for the button label.",
        applyOutcome: "Creates a draft for review.",
        declineOutcome: "Records this proposal as declined.",
        decisionState: "current",
        ctaEvidence: [
          sampleEvidence({
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
  })
  data.alerts = [
    {
      id: "coverage",
      severity: "warning",
      title: "Some evidence is missing",
      detail: "Download completion is not connected.",
    },
  ]
  return data
}
