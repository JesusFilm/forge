import { z } from "zod"

import type {
  AiTrafficEvidence,
  CtaEvidence,
  EvidenceFamily,
  ViewingEvidence,
  WatchSeoMarketingData,
} from "@/components/watch/seo/types"

const state = z.enum([
  "available",
  "partial",
  "stale",
  "compacted",
  "unavailable",
  "not_connected",
])
const source = z.object({
  kind: z.string(),
  provider: z.string().nullable(),
})
const sectionBase = {
  state,
  reason: z.string().nullable(),
  source,
  retrievedAt: z.string().nullable(),
  window: z.object({ start: z.string(), end: z.string() }).nullable(),
  caveats: z.array(z.string()),
}
const section = <T extends z.ZodType>(data: T) =>
  z.object({ ...sectionBase, data: data.nullable() })

const metadata = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
  searchTitle: z.string().nullable(),
  searchDescription: z.string().nullable(),
  hasSocialImage: z.boolean(),
})
const search = z.object({
  queries: z.array(
    z.object({
      clicks: z.number().finite(),
      impressions: z.number().finite(),
      position: z.number().finite(),
      observedAt: z.string(),
    }),
  ),
})
const crawl = z.object({
  provider: z.enum(["firecrawl", "direct_page"]),
  title: z.string().nullable(),
  description: z.string().nullable(),
  fetcherCacheState: z.string().nullable(),
  fetcherCachedAt: z.string().nullable(),
  complete: z.boolean(),
})
const proposals = z.object({
  proposals: z.array(
    z.object({
      id: z.string(),
      version: z.number().int().nonnegative(),
      payloadDigest: z.string(),
      decisionState: z.enum([
        "current",
        "expired",
        "decided",
        "stale",
        "materialized",
      ]),
      intent: z.string(),
      expectedOutcome: z.string(),
      risk: z.string(),
      verificationPlan: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          before: z.string().nullable(),
          after: z.string().nullable(),
        }),
      ),
      caveats: z.array(z.string()),
    }),
  ),
})
const routeAlerts = z.object({
  alerts: z.array(
    z.object({
      lifecycle: z.string(),
      verdict: z.string(),
      severity: z.string(),
      latestCount: z.number().finite(),
      lastHttpStatus: z.number().finite().nullable(),
    }),
  ),
})
const unavailable = z.never()

const readModelSchema = z.object({
  version: z.literal("watch-seo-read-model/v1"),
  identity: z.object({
    videoSlug: z.string(),
    languageSlug: z.string(),
    locale: z.string().nullable(),
    videoLocaleId: z.string(),
    canonicalUrl: z.string(),
    contextualParentSlug: z.string().nullable(),
  }),
  sections: z.object({
    pageMetadata: section(metadata),
    search: section(search),
    crawl: section(crawl),
    ga4PageAndCta: section(unavailable),
    watchDepth: section(unavailable),
    aiReferrals: section(unavailable),
    botVisits: section(unavailable),
    cacheHistory: section(unavailable),
    routeAlerts: section(routeAlerts),
    proposals: section(proposals),
  }),
})

type WireSection = z.infer<typeof readModelSchema>["sections"]["search"]
type ProvenanceInput = Pick<
  WireSection,
  "state" | "reason" | "source" | "retrievedAt" | "window" | "caveats"
>

function provenance<T>(
  value: ProvenanceInput,
  data: T | null,
): EvidenceFamily<T> {
  return {
    state: value.state,
    source: [value.source.kind, value.source.provider]
      .filter(Boolean)
      .join(" · "),
    window: value.window,
    observedAt: value.retrievedAt,
    note: [value.reason, ...value.caveats].filter(Boolean).join(" — ") || null,
    data,
  }
}

export function adaptWatchSeoReadModel(
  input: unknown,
): WatchSeoMarketingData | null {
  const parsed = readModelSchema.safeParse(input)
  if (!parsed.success) return null
  const model = parsed.data
  const { sections, identity } = model
  const page = sections.pageMetadata.data

  const daily = new Map<string, { total: number; count: number }>()
  for (const query of sections.search.data?.queries ?? []) {
    const date = query.observedAt.slice(0, 10)
    const current = daily.get(date) ?? { total: 0, count: 0 }
    current.total += query.position
    current.count += 1
    daily.set(date, current)
  }
  const queries = sections.search.data?.queries ?? []
  const clicks = queries.reduce((sum, query) => sum + query.clicks, 0)
  const impressions = queries.reduce((sum, query) => sum + query.impressions, 0)
  const rankingData = sections.search.data
    ? {
        averagePosition:
          queries.length > 0
            ? queries.reduce((sum, query) => sum + query.position, 0) /
              queries.length
            : null,
        clicks,
        impressions,
        ctrPercent: impressions > 0 ? (clicks / impressions) * 100 : null,
        comparisonWindow: null,
        points: [...daily.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, value]) => ({
            date,
            position: value.count > 0 ? value.total / value.count : null,
          })),
      }
    : null

  const crawlerData = sections.crawl.data
    ? {
        renderingMode: "direct_http" as const,
        textExcerpt: null,
        botVisits: null,
        lastVisitAt: null,
        cacheStatus: sections.crawl.data.fetcherCacheState,
        indexingStatus: "Not verified",
        notes: [
          "A stored HTTP fetch does not prove search indexing or a search-bot visit.",
          ...sections.crawl.caveats,
        ],
      }
    : null

  const previewData = page
    ? {
        canonicalUrl: identity.canonicalUrl,
        title: page.searchTitle ?? page.title,
        description: page.searchDescription ?? page.description,
        imageUrl: null,
        imageAlt: null,
      }
    : null

  const alerts = (sections.routeAlerts.data?.alerts ?? []).map(
    (alert, index) => ({
      id: `route-${index}`,
      severity:
        alert.severity.toLowerCase() === "error"
          ? ("error" as const)
          : alert.severity.toLowerCase() === "warning"
            ? ("warning" as const)
            : ("info" as const),
      title: `Route ${alert.verdict}`,
      detail: `${alert.lifecycle}; ${alert.latestCount} recent event${alert.latestCount === 1 ? "" : "s"}${alert.lastHttpStatus == null ? "" : `; last HTTP ${alert.lastHttpStatus}`}.`,
    }),
  )

  const opportunityData = sections.proposals.data
    ? {
        items: sections.proposals.data.proposals.map((proposal) => ({
          proposalId: proposal.id,
          version: proposal.version,
          payloadDigest: proposal.payloadDigest,
          title: proposal.intent,
          evidence: proposal.verificationPlan,
          expectedImpact: proposal.expectedOutcome,
          confidence: proposal.risk,
          actionSummary:
            proposal.changes
              .map((change) => change.field)
              .filter(Boolean)
              .join(", ") || proposal.intent,
          applyOutcome: "Creates an editorial draft or ticket for review.",
          declineOutcome: "Records this proposal as declined.",
          decisionState:
            proposal.decisionState === "decided" ||
            proposal.decisionState === "materialized"
              ? ("already_decided" as const)
              : proposal.decisionState,
          ctaEvidence: [],
        })),
      }
    : null

  const unavailableReach = {
    pageViews: null,
    visitors: null,
    searchClicks: null,
    searchImpressions: null,
    videoSearchClicks: null,
    videoSearchImpressions: null,
  }

  return {
    schemaVersion: "watch-seo-marketing-v1",
    page: {
      videoId: identity.videoSlug,
      dubId: identity.videoLocaleId,
      language: identity.languageSlug,
      title: page?.title ?? identity.videoSlug,
      canonicalUrl: identity.canonicalUrl,
      // The upstream model proves only the parent slug, not a complete
      // contextual canonical URL. Do not present a slug as if it were a URL.
      contextualUrl: null,
    },
    rankings: provenance(sections.search, rankingData),
    reach: provenance(sections.ga4PageAndCta, unavailableReach),
    viewing: provenance<ViewingEvidence>(sections.watchDepth, null),
    ctaOutcomes: provenance<{ items: CtaEvidence[] }>(
      sections.ga4PageAndCta,
      null,
    ),
    aiTraffic: provenance<AiTrafficEvidence>(sections.aiReferrals, null),
    content: provenance(
      sections.pageMetadata,
      page
        ? {
            title: page.title,
            description: page.description,
            canonicalUrl: identity.canonicalUrl,
            checks: [
              {
                label: "Page title",
                detail: page.title
                  ? "A stored page title is present."
                  : "No stored page title is available.",
                state: page.title ? ("pass" as const) : ("warning" as const),
              },
            ],
          }
        : null,
    ),
    crawler: provenance(sections.crawl, crawlerData),
    previews: provenance(sections.pageMetadata, previewData),
    opportunities: provenance(sections.proposals, opportunityData),
    alerts,
  }
}
