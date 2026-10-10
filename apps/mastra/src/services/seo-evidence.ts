import { z } from "zod"

export const SeoEvidenceObservationSchema = z
  .object({
    id: z.string().min(1).max(200),
    provider: z.enum([
      "gsc",
      "ga4",
      "firecrawl",
      "openai_web_search",
      "page_fetch",
    ]),
    status: z.enum(["available", "partial", "unavailable"]),
    retrievedAt: z.string().datetime(),
    scope: z
      .object({
        canonicalUrl: z.string().url().optional(),
        locale: z.string().max(35).optional(),
        propertyId: z.string().max(500).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
      .strict(),
    data: z.record(z.string(), z.unknown()),
    quality: z
      .object({
        complete: z.boolean(),
        truncated: z.boolean(),
        caveats: z.array(z.string().max(500)).max(20),
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            url: z.string().url(),
            title: z.string().max(500).nullable(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()

export type SeoEvidenceObservation = z.infer<
  typeof SeoEvidenceObservationSchema
>

export type SeoProviderFailure = {
  ok: false
  reason:
    | "config_missing"
    | "not_allowed"
    | "auth_failed"
    | "rate_limited"
    | "timeout"
    | "network_error"
    | "rejected"
    | "parse_error"
  retryable: boolean
  status?: number
}
