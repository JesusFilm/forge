/** Local presentation DTOs. The private read adapter owns validation and authorization. */
export type SeoAvailability =
  | "available"
  | "partial"
  | "unavailable"
  | "not_connected"
  | "stale"
  | "compacted"
  | "unknown"

export type ReportingWindow = { start: string; end: string }

export type EvidenceFamily<T> = {
  state: SeoAvailability
  source: string | null
  window: ReportingWindow | null
  observedAt: string | null
  note?: string | null
  data: T | null
}

export type RankingEvidence = {
  averagePosition: number | null
  clicks: number | null
  impressions: number | null
  ctrPercent: number | null
  comparisonWindow: ReportingWindow | null
  /** Daily aggregate only. Query-level detail stays on Admin. Nulls are gaps. */
  points: { date: string; position: number | null }[]
}

export type ReachEvidence = {
  pageViews: number | null
  visitors: number | null
  searchClicks: number | null
  searchImpressions: number | null
  videoSearchClicks: number | null
  videoSearchImpressions: number | null
}

export type ViewingEvidence = {
  starts: number | null
  completions: number | null
  completionRatePercent: number | null
  averageWatchedPercent: number | null
  retention: {
    percentWatched: number
    viewers: number | null
    percentOfStarts: number | null
  }[]
}

export type CtaEvidence = {
  id: string
  label: string
  clicks: number | null
  outcomes: number | null
  outcomeLabel: string
  /** Supplied measurement population; never inferred from another source. */
  denominator: number | null
  attributionNote: string
}

export type AiTrafficEvidence = {
  visits: number | null
  assistants: { name: string; visits: number | null }[]
}

export type ContentEvidence = {
  title: string | null
  description: string | null
  canonicalUrl: string | null
  checks: {
    label: string
    detail: string
    state: "pass" | "warning" | "unavailable"
  }[]
}

export type CrawlerEvidence = {
  renderingMode: "direct_http" | "rendered" | null
  textExcerpt: string | null
  botVisits: number | null
  lastVisitAt: string | null
  cacheStatus: string | null
  indexingStatus: string | null
  notes: string[]
}

export type PreviewEvidence = {
  canonicalUrl: string | null
  title: string | null
  description: string | null
  /** Public canonical image only; the adapter must exclude signed URLs. */
  imageUrl: string | null
  imageAlt: string | null
}

export type OpportunityDecisionState =
  | "current"
  | "stale"
  | "expired"
  | "already_decided"
  | "conflict"
  | "replay"
  | "rejected"
  | "retryable_error"

export type SeoOpportunity = {
  proposalId: string
  version: number
  payloadDigest: string
  title: string
  evidence: string
  expectedImpact: string
  confidence: string
  actionSummary: string
  applyOutcome: string
  declineOutcome: string
  decisionState: OpportunityDecisionState
  ctaEvidence: EvidenceFamily<CtaEvidence>[]
}

export type WatchSeoMarketingData = {
  schemaVersion: "watch-seo-marketing-v1"
  page: {
    videoId: string
    dubId: string | null
    language: string
    title: string
    canonicalUrl: string
    contextualUrl: string | null
  }
  rankings: EvidenceFamily<RankingEvidence>
  reach: EvidenceFamily<ReachEvidence>
  viewing: EvidenceFamily<ViewingEvidence>
  ctaOutcomes: EvidenceFamily<{ items: CtaEvidence[] }>
  aiTraffic: EvidenceFamily<AiTrafficEvidence>
  content: EvidenceFamily<ContentEvidence>
  crawler: EvidenceFamily<CrawlerEvidence>
  previews: EvidenceFamily<PreviewEvidence>
  opportunities: EvidenceFamily<{ items: SeoOpportunity[] }>
  alerts: {
    id: string
    severity: "info" | "warning" | "error"
    title: string
    detail: string
  }[]
}

export type SeoPanelState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "empty" }
  | { status: "ready"; data: WatchSeoMarketingData }

/** The parent renders these controls only after authoritative Admin capability. */
export type SeoMarketingPanelProps = {
  id: string
  labelledBy: string
  state: SeoPanelState
  adminOrigin: string
  /** Exact Admin confirmation endpoint supplied by the parent; never a Watch URL. */
  adminConfirmationUrl: string
  onRetry?: () => void
}
