import { createHash, randomUUID } from "node:crypto"

import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import { getFirecrawlConfig } from "../../config/env"
import {
  getSeoCapabilities,
  getSeoConfig,
  type SeoCapabilities,
} from "../../config/seo"
import { scrapeFirecrawl } from "../../services/firecrawl-client"
import { queryGoogleAnalytics } from "../../services/google-analytics-client"
import { queryGoogleSearchConsole } from "../../services/google-search-console-client"
import { searchGroundedWeb } from "../../services/grounded-search-client"
import {
  minimizeSeoText,
  minimizeSeoUrl,
} from "../../services/seo-data-minimization"
import { SeoEvidenceObservationSchema } from "../../services/seo-evidence"
import { validateSeoUrl } from "../../services/seo-http"

const FailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum([
      "config_missing",
      "not_allowed",
      "auth_failed",
      "rate_limited",
      "timeout",
      "network_error",
      "rejected",
      "parse_error",
    ]),
    retryable: z.boolean(),
    status: z.number().int().optional(),
  })
  .strict()

export const SeoEvidenceToolOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({ ok: z.literal(true), observation: SeoEvidenceObservationSchema })
    .strict(),
  FailureSchema,
])

function failure(result: {
  reason: string
  retryable: boolean
  status?: number
}): z.infer<typeof FailureSchema> {
  const reason = [
    "config_missing",
    "not_allowed",
    "auth_failed",
    "rate_limited",
    "timeout",
    "network_error",
    "rejected",
    "parse_error",
  ].includes(result.reason)
    ? (result.reason as z.infer<typeof FailureSchema>["reason"])
    : result.reason === "invalid_response"
      ? "parse_error"
      : "network_error"
  return {
    ok: false,
    reason,
    retryable: result.retryable,
    ...(result.status == null ? {} : { status: result.status }),
  }
}

export async function executeGscEvidence(input: {
  propertyId: string
  startDate: string
  endDate: string
  dimensions?: Array<"date" | "query" | "page" | "country" | "device">
}) {
  const result = await queryGoogleSearchConsole({
    ...input,
    dimensions: input.dimensions ?? ["page", "query"],
  })
  return result.ok
    ? { ok: true as const, observation: result.observation }
    : failure(result)
}

export async function executeGa4Evidence(input: {
  propertyId: string
  startDate: string
  endDate: string
}) {
  const result = await queryGoogleAnalytics(input)
  return result.ok
    ? { ok: true as const, observation: result.observation }
    : failure(result)
}

export async function executeFirecrawlPageEvidence(
  input: { canonicalUrl: string; locale?: string; liveFetch?: boolean },
  options: {
    resolveHost?: Parameters<typeof validateSeoUrl>[1]["resolveHost"]
    scrape?: typeof scrapeFirecrawl
  } = {},
) {
  const config = getSeoConfig()
  const safe = await validateSeoUrl(input.canonicalUrl, {
    allowedHosts: config.allowedPageHosts,
    resolveHost: options.resolveHost,
  })
  if (!safe.ok) {
    return failure({ reason: "not_allowed", retryable: false })
  }
  const result = await (options.scrape ?? scrapeFirecrawl)({
    url: safe.url.toString(),
    onlyMainContent: true,
    liveFetch: input.liveFetch ?? true,
  })
  if (!result.ok) return failure(result)
  const returnedUrl = minimizeSeoUrl(result.result.url)
  if (!returnedUrl) return failure({ reason: "not_allowed", retryable: false })
  const returnedSafe = await validateSeoUrl(returnedUrl, {
    allowedHosts: config.allowedPageHosts,
    resolveHost: options.resolveHost,
  })
  if (!returnedSafe.ok) {
    return failure({ reason: "not_allowed", retryable: false })
  }
  return {
    ok: true as const,
    observation: {
      id: `firecrawl-${createHash("sha256")
        .update(`${returnedUrl}:${randomUUID()}`)
        .digest("hex")
        .slice(0, 20)}`,
      provider: "firecrawl" as const,
      status: result.result.markdownTruncated
        ? ("partial" as const)
        : ("available" as const),
      retrievedAt: new Date().toISOString(),
      scope: {
        canonicalUrl: returnedUrl,
        ...(input.locale ? { locale: input.locale.slice(0, 35) } : {}),
      },
      data: {
        title: result.result.title
          ? minimizeSeoText(result.result.title, 500)
          : null,
        description: result.result.description
          ? minimizeSeoText(result.result.description, 1_000)
          : null,
        markdown: minimizeSeoText(result.result.markdown, 16_000),
        statusCode: result.result.statusCode,
        contentType: result.result.contentType,
        cacheState: result.result.cacheState ?? null,
        cachedAt: result.result.cachedAt ?? null,
        liveFetchRequested: input.liveFetch ?? true,
      },
      quality: {
        complete: !result.result.markdownTruncated,
        truncated: result.result.markdownTruncated,
        caveats: [
          "Firecrawl is page-state evidence and does not prove Google indexing or ranking.",
          ...(result.result.markdownTruncated
            ? ["Page markdown was truncated at the configured evidence cap."]
            : []),
        ],
      },
      sources: [{ url: returnedUrl, title: result.result.title }],
    },
  }
}

export async function executeGroundedEvidence(input: {
  query: string
  canonicalUrl?: string
  locale?: string
}) {
  const result = await searchGroundedWeb(input)
  return result.ok
    ? { ok: true as const, observation: result.observation }
    : failure(result)
}

const CapabilitiesOutputSchema = z
  .object({
    gsc: z.boolean(),
    ga4: z.boolean(),
    firecrawl: z.boolean(),
    groundedSearch: z.boolean(),
    adminLedger: z.boolean(),
    linearDispatch: z.boolean(),
  })
  .strict()

export function seoCapabilities(): SeoCapabilities {
  return getSeoCapabilities(
    getSeoConfig(),
    Boolean(getFirecrawlConfig().apiKey),
  )
}

export const seoEvidenceCapabilitiesTool = createTool({
  id: "seoEvidenceCapabilities",
  description:
    "Report which SEO evidence lanes are configured. Unavailable means no evidence, never zero performance.",
  inputSchema: z.object({}).strict(),
  outputSchema: CapabilitiesOutputSchema,
  execute: async () => seoCapabilities(),
})

export const seoGscEvidenceTool = createTool({
  id: "seoGscEvidence",
  description:
    "Read bounded Search Console Search Analytics rows from an exactly configured property. Missing rows remain unobserved, not zero.",
  inputSchema: z
    .object({
      propertyId: z.string().min(1).max(500),
      startDate: z.string(),
      endDate: z.string(),
      dimensions: z
        .array(z.enum(["date", "query", "page", "country", "device"]))
        .min(1)
        .max(5)
        .default(["page", "query"]),
    })
    .strict(),
  outputSchema: SeoEvidenceToolOutputSchema,
  execute: async (input) => executeGscEvidence(input),
})

export const seoGa4EvidenceTool = createTool({
  id: "seoGa4Evidence",
  description:
    "Read bounded GA4 landing-page/date aggregate guardrails from an exactly configured property.",
  inputSchema: z
    .object({
      propertyId: z.string().min(1).max(100),
      startDate: z.string(),
      endDate: z.string(),
    })
    .strict(),
  outputSchema: SeoEvidenceToolOutputSchema,
  execute: async (input) => executeGa4Evidence(input),
})

export const seoFirecrawlPageEvidenceTool = createTool({
  id: "seoFirecrawlPageEvidence",
  description:
    "Read a configured public canonical through the existing Firecrawl client. This is page-state evidence, not indexing proof.",
  inputSchema: z
    .object({
      canonicalUrl: z.string().url(),
      locale: z.string().max(35).optional(),
      liveFetch: z.boolean().default(true),
    })
    .strict(),
  outputSchema: SeoEvidenceToolOutputSchema,
  execute: async (input) => executeFirecrawlPageEvidence(input),
})

export const seoGroundedSearchEvidenceTool = createTool({
  id: "seoGroundedSearchEvidence",
  description:
    "Collect one bounded grounded web-search observation with retained citations. Citation URLs are never auto-fetched.",
  inputSchema: z
    .object({
      query: z.string().min(1).max(500),
      canonicalUrl: z.string().url().optional(),
      locale: z.string().max(35).optional(),
    })
    .strict(),
  outputSchema: SeoEvidenceToolOutputSchema,
  execute: async (input) => executeGroundedEvidence(input),
})
