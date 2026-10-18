// Versioned wire contract for the admin-only Watch SEO tab (feat-712).
//
// This file is the producer's source of truth. Web mirrors it through its own
// local schema; nothing here is imported across apps. Every value on the wire
// is either a bounded scalar projected from stored evidence or a typed
// coverage state — raw provider JSON never appears, and an absent measurement
// is never encoded as a number.

export const WATCH_SEO_READ_MODEL_VERSION = "watch-seo-read-model/v1" as const
export const WATCH_SEO_CAPABILITY_VERSION = "watch-seo-capability/v1" as const

// Header carrying the delegated Web user's access token. The service key
// travels in `Authorization`; the two credentials are never interchangeable.
export const WATCH_SEO_USER_TOKEN_HEADER = "x-watch-user-authorization"

// Detail evidence follows the repo-wide 29-day compaction boundary
// (SEO_RUN_DETAIL_RETENTION_DAYS). A row completed 29 days ago is expired.
export const WATCH_SEO_DETAIL_WINDOW_DAYS = 29
export const WATCH_SEO_DETAIL_WINDOW_MS =
  WATCH_SEO_DETAIL_WINDOW_DAYS * 24 * 60 * 60 * 1000

// Evidence older than this is still returned but labelled `stale`.
export const WATCH_SEO_STALE_AFTER_MS = 8 * 24 * 60 * 60 * 1000
export const WATCH_SEO_MANIFEST_STALE_AFTER_MS = 48 * 60 * 60 * 1000
export const WATCH_SEO_ALERT_MONITOR_STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000

/**
 * - `available`     stored evidence is complete for what this section claims
 * - `partial`       stored evidence exists but is known to be incomplete
 * - `stale`         evidence exists but is older than its freshness budget
 * - `compacted`     detail existed but aged past the 29-day boundary
 * - `unavailable`   no retained evidence; the value is UNKNOWN, never zero
 * - `not_connected` no durable per-page source exists yet (follow-up ingestion)
 */
export type WatchSeoEvidenceState =
  | "available"
  | "partial"
  | "stale"
  | "compacted"
  | "unavailable"
  | "not_connected"

export type WatchSeoSectionReason =
  | "no_recent_run"
  | "no_retained_rows_for_page"
  | "no_recent_observation"
  | "detail_window_elapsed"
  | "no_manifest_snapshot"
  | "monitor_not_run"
  | "no_per_page_projection"
  | "no_bot_log_source"
  | "no_cache_history_source"
  | "no_ai_referral_source"
  | "no_watch_depth_source"
  | "read_failed"

export type WatchSeoSource = {
  kind:
    | "admin_database"
    | "retained_ledger"
    | "stored_observation"
    | "manifest_snapshot"
    | "route_alert_ledger"
    | "not_connected"
  provider: "gsc" | "ga4" | "firecrawl" | "direct_page" | null
}

export type WatchSeoSection<T> = {
  state: WatchSeoEvidenceState
  reason: WatchSeoSectionReason | null
  source: WatchSeoSource
  // Last time the underlying evidence was retrieved; null when unknown.
  retrievedAt: string | null
  // The reporting window the evidence covers; null when it has none.
  window: { start: string; end: string } | null
  // Present only when there is something to show. Never a numeric placeholder.
  data: T | null
  caveats: string[]
}

export type WatchSeoIdentity = {
  videoSlug: string
  languageSlug: string
  locale: string | null
  videoLocaleId: string
  // Standalone search canonical. Distinct from the contextual route below.
  canonicalUrl: string
  canonicalPath: string
  // Parent collection slug when the viewer is on a contextual episode route.
  contextualParentSlug: string | null
  noIndex: boolean
}

export type WatchSeoPageMetadata = {
  status: string
  title: string | null
  description: string | null
  searchTitle: string | null
  searchDescription: string | null
  hasSocialImage: boolean
  updatedAt: string
}

export type WatchSeoHreflang = {
  inManifest: boolean
  manifestVersion: string
  alternates: Array<{ hreflang: string; languageSlug: string }>
  omittedAlternateCount: number
}

export type WatchSeoSearchQuery = {
  query: string
  clicks: number
  impressions: number
  ctr: number
  // Search position: a SMALLER number is a better ranking.
  position: number
  observedAt: string
}

export type WatchSeoSearch = {
  kind: "retained_selection_decisions"
  queries: WatchSeoSearchQuery[]
  omittedQueryCount: number
  droppedMalformedRowCount: number
  runCount: number
}

export type WatchSeoCrawlObservation = {
  kind: "page_state_fetch"
  provider: "firecrawl" | "direct_page"
  renderingMode: "direct_http" | "rendered" | null
  httpStatus: number | null
  contentType: string | null
  title: string | null
  description: string | null
  // Cache state reported by the fetching provider; NOT a Googlebot cache.
  fetcherCacheState: string | null
  fetcherCachedAt: string | null
  complete: boolean
}

export type WatchSeoProviderCoverage = {
  latestRunAt: string
  latestRunStatus: "completed" | "partial"
  providers: Record<string, "available" | "partial" | "unavailable">
}

export type WatchSeoRouteAlert = {
  lifecycle: string
  verdict: string
  severity: string
  latestCount: number
  countKind: string
  activeUsers: number
  firstSeenAt: string
  lastSeenAt: string
  lastProbedAt: string | null
  lastHttpStatus: number | null
  lastProbeKind: string | null
  recoveredAt: string | null
}

export type WatchSeoRouteAlerts = {
  monitoredThrough: string | null
  alerts: WatchSeoRouteAlert[]
}

export type WatchSeoEvaluation = {
  kind: string
  outcome: string
  observedAt: string
  // Finite numeric scalars only; non-numeric metric values are dropped.
  metrics: Record<string, number>
}

export type WatchSeoExperiment = {
  status: string
  activatedAt: string | null
  measurementStartsAt: string | null
  interimDueAt: string | null
  finalDueAt: string | null
  confounderCount: number
  evaluations: WatchSeoEvaluation[]
}

export type WatchSeoProposalChange = {
  field: string
  before: string | null
  after: string | null
}

export type WatchSeoProposal = {
  id: string
  // Immutable identity a later Admin-origin decision binds to.
  version: number
  payloadDigest: string
  status: string
  // `current` is decidable; the rest explain why it is not.
  decisionState: "current" | "expired" | "decided" | "stale" | "materialized"
  lane: string
  intent: string
  expectedOutcome: string
  risk: string
  verificationPlan: string
  rollbackPlan: string
  affectedFields: string[]
  changes: WatchSeoProposalChange[]
  caveats: string[]
  expiresAt: string
  createdAt: string
  decision: { action: string; decidedAt: string } | null
  materialization: {
    status: string
    hasDraft: boolean
    hasTicket: boolean
  } | null
  experiment: WatchSeoExperiment | null
}

export type WatchSeoProposals = { proposals: WatchSeoProposal[] }

export const WATCH_SEO_SECTION_KEYS = [
  "pageMetadata",
  "hreflang",
  "search",
  "crawl",
  "providerCoverage",
  "ga4PageAndCta",
  "watchDepth",
  "aiReferrals",
  "botVisits",
  "cacheHistory",
  "routeAlerts",
  "proposals",
] as const

export type WatchSeoSectionKey = (typeof WATCH_SEO_SECTION_KEYS)[number]

// Sections with no durable per-page source carry no data type by design.
export type WatchSeoUnavailableData = never

export type WatchSeoReadModel = {
  version: typeof WATCH_SEO_READ_MODEL_VERSION
  generatedAt: string
  detailWindowDays: typeof WATCH_SEO_DETAIL_WINDOW_DAYS
  identity: WatchSeoIdentity
  sections: {
    pageMetadata: WatchSeoSection<WatchSeoPageMetadata>
    hreflang: WatchSeoSection<WatchSeoHreflang>
    search: WatchSeoSection<WatchSeoSearch>
    crawl: WatchSeoSection<WatchSeoCrawlObservation>
    providerCoverage: WatchSeoSection<WatchSeoProviderCoverage>
    ga4PageAndCta: WatchSeoSection<WatchSeoUnavailableData>
    watchDepth: WatchSeoSection<WatchSeoUnavailableData>
    aiReferrals: WatchSeoSection<WatchSeoUnavailableData>
    botVisits: WatchSeoSection<WatchSeoUnavailableData>
    cacheHistory: WatchSeoSection<WatchSeoUnavailableData>
    routeAlerts: WatchSeoSection<WatchSeoRouteAlerts>
    proposals: WatchSeoSection<WatchSeoProposals>
  }
}

export type WatchSeoCapabilityResponse = {
  canViewWatchSeo: boolean
}
