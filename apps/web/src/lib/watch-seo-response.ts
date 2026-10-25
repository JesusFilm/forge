import { z } from "zod"

import type { WatchSeoMarketingData } from "@/components/watch/seo/types"

const nullableText = z.string().nullable()
const nullableNumber = z.number().finite().nullable()
const windowSchema = z.object({ start: z.string(), end: z.string() })
const availabilitySchema = z.enum([
  "available",
  "partial",
  "unavailable",
  "not_connected",
  "stale",
  "compacted",
  "unknown",
])

function evidenceSchema<T extends z.ZodType>(data: T) {
  return z.object({
    state: availabilitySchema,
    source: nullableText,
    window: windowSchema.nullable(),
    observedAt: nullableText,
    note: nullableText.optional(),
    data: data.nullable(),
  })
}

const ctaSchema = z.object({
  id: z.string(),
  label: z.string(),
  clicks: nullableNumber,
  outcomes: nullableNumber,
  outcomeLabel: z.string(),
  denominator: nullableNumber,
  attributionNote: z.string(),
})

const responseSchema = z.object({
  schemaVersion: z.literal("watch-seo-marketing-v1"),
  page: z.object({
    videoId: z.string(),
    dubId: nullableText,
    language: z.string(),
    title: z.string(),
    canonicalUrl: z.string(),
    contextualUrl: nullableText,
  }),
  rankings: evidenceSchema(
    z.object({
      averagePosition: nullableNumber,
      clicks: nullableNumber,
      impressions: nullableNumber,
      ctrPercent: nullableNumber,
      comparisonWindow: windowSchema.nullable(),
      points: z.array(z.object({ date: z.string(), position: nullableNumber })),
    }),
  ),
  reach: evidenceSchema(
    z.object({
      pageViews: nullableNumber,
      visitors: nullableNumber,
      searchClicks: nullableNumber,
      searchImpressions: nullableNumber,
      videoSearchClicks: nullableNumber,
      videoSearchImpressions: nullableNumber,
    }),
  ),
  viewing: evidenceSchema(
    z.object({
      starts: nullableNumber,
      completions: nullableNumber,
      completionRatePercent: nullableNumber,
      averageWatchedPercent: nullableNumber,
      retention: z.array(
        z.object({
          percentWatched: z.number().finite(),
          viewers: nullableNumber,
          percentOfStarts: nullableNumber,
        }),
      ),
    }),
  ),
  ctaOutcomes: evidenceSchema(z.object({ items: z.array(ctaSchema) })),
  aiTraffic: evidenceSchema(
    z.object({
      visits: nullableNumber,
      assistants: z.array(
        z.object({ name: z.string(), visits: nullableNumber }),
      ),
    }),
  ),
  content: evidenceSchema(
    z.object({
      title: nullableText,
      description: nullableText,
      canonicalUrl: nullableText,
      checks: z.array(
        z.object({
          label: z.string(),
          detail: z.string(),
          state: z.enum(["pass", "warning", "unavailable"]),
        }),
      ),
    }),
  ),
  crawler: evidenceSchema(
    z.object({
      renderingMode: z.enum(["direct_http", "rendered"]).nullable(),
      textExcerpt: nullableText,
      botVisits: nullableNumber,
      lastVisitAt: nullableText,
      cacheStatus: nullableText,
      indexingStatus: nullableText,
      notes: z.array(z.string()),
    }),
  ),
  previews: evidenceSchema(
    z.object({
      canonicalUrl: nullableText,
      title: nullableText,
      description: nullableText,
      imageUrl: nullableText,
      imageAlt: nullableText,
    }),
  ),
  opportunities: evidenceSchema(
    z.object({
      items: z.array(
        z.object({
          proposalId: z.string(),
          version: z.number().int().nonnegative(),
          payloadDigest: z.string(),
          title: z.string(),
          evidence: z.string(),
          expectedImpact: z.string(),
          confidence: z.string(),
          actionSummary: z.string(),
          applyOutcome: z.string(),
          declineOutcome: z.string(),
          decisionState: z.enum([
            "current",
            "stale",
            "expired",
            "already_decided",
            "conflict",
            "replay",
            "rejected",
            "retryable_error",
          ]),
          ctaEvidence: z.array(evidenceSchema(ctaSchema)),
        }),
      ),
    }),
  ),
  alerts: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(["info", "warning", "error"]),
      title: z.string(),
      detail: z.string(),
    }),
  ),
})

export function parseWatchSeoMarketingData(
  value: unknown,
): WatchSeoMarketingData | null {
  const parsed = responseSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
