import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import {
  scrapeFirecrawl,
  searchFirecrawl,
  type FirecrawlClientFailure,
  type FirecrawlScrapeInput,
  type FirecrawlSearchInput,
} from "../../services/firecrawl-client"

export const firecrawlFailureReasonSchema = z.enum([
  "config_missing",
  "auth_failed",
  "network_error",
  "rate_limited",
  "rejected",
  "parse_error",
  "invalid_response",
])

export const firecrawlFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: firecrawlFailureReasonSchema,
    retryable: z.boolean(),
    status: z.number().int().optional(),
    upstreamReason: z.string().optional(),
  })
  .strict()

export const firecrawlSearchToolInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Search query for current public web data."),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(20)
      .default(5)
      .describe("Maximum web results to return."),
    includeMarkdown: z
      .boolean()
      .default(false)
      .describe("Also hydrate search results with bounded markdown content."),
    timeoutMs: z.coerce
      .number()
      .int()
      .min(1000)
      .max(300_000)
      .optional()
      .describe("Optional Firecrawl request timeout in milliseconds."),
  })
  .strict()

const firecrawlSearchResultSchema = z
  .object({
    title: z.string().nullable(),
    url: z.string().url(),
    description: z.string().nullable(),
    markdown: z.string().nullable(),
    markdownTruncated: z.boolean(),
  })
  .strict()

export const firecrawlSearchToolOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      query: z.string(),
      results: z.array(firecrawlSearchResultSchema),
      creditsUsed: z.number().nullable(),
    })
    .strict(),
  firecrawlFailureSchema,
])

export const firecrawlScrapeToolInputSchema = z
  .object({
    url: z.string().url().describe("Public page URL to scrape."),
    onlyMainContent: z
      .boolean()
      .default(true)
      .describe("Filter boilerplate before returning markdown."),
    timeoutMs: z.coerce
      .number()
      .int()
      .min(1000)
      .max(300_000)
      .optional()
      .describe("Optional Firecrawl request timeout in milliseconds."),
  })
  .strict()

export const firecrawlScrapeToolOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      url: z.string().url(),
      markdown: z.string(),
      markdownTruncated: z.boolean(),
      title: z.string().nullable(),
      description: z.string().nullable(),
      statusCode: z.number().int().nullable(),
      contentType: z.string().nullable(),
    })
    .strict(),
  firecrawlFailureSchema,
])

export type FirecrawlSearchToolInput = z.input<
  typeof firecrawlSearchToolInputSchema
>
export type FirecrawlSearchToolOutput = z.output<
  typeof firecrawlSearchToolOutputSchema
>

export type FirecrawlScrapeToolInput = z.input<
  typeof firecrawlScrapeToolInputSchema
>
export type FirecrawlScrapeToolOutput = z.output<
  typeof firecrawlScrapeToolOutputSchema
>

function failureOutput(
  failure: FirecrawlClientFailure,
): z.output<typeof firecrawlFailureSchema> {
  return {
    ok: false,
    reason: failure.reason,
    retryable: failure.retryable,
    ...(failure.status == null ? {} : { status: failure.status }),
    ...(failure.upstreamReason == null
      ? {}
      : { upstreamReason: failure.upstreamReason }),
  }
}

export async function executeFirecrawlSearchTool(
  input: FirecrawlSearchToolInput,
  options: {
    search?: (input: FirecrawlSearchInput) => ReturnType<typeof searchFirecrawl>
  } = {},
): Promise<FirecrawlSearchToolOutput> {
  const parsed = firecrawlSearchToolInputSchema.parse(input)
  const response = await (options.search ?? searchFirecrawl)({
    query: parsed.query,
    limit: parsed.limit,
    includeMarkdown: parsed.includeMarkdown,
    ...(parsed.timeoutMs == null ? {} : { timeoutMs: parsed.timeoutMs }),
  })

  if (!response.ok) return failureOutput(response)
  return {
    ok: true,
    query: response.result.query,
    results: response.result.results,
    creditsUsed: response.result.creditsUsed,
  }
}

export async function executeFirecrawlScrapeTool(
  input: FirecrawlScrapeToolInput,
  options: {
    scrape?: (input: FirecrawlScrapeInput) => ReturnType<typeof scrapeFirecrawl>
  } = {},
): Promise<FirecrawlScrapeToolOutput> {
  const parsed = firecrawlScrapeToolInputSchema.parse(input)
  const response = await (options.scrape ?? scrapeFirecrawl)({
    url: parsed.url,
    onlyMainContent: parsed.onlyMainContent,
    ...(parsed.timeoutMs == null ? {} : { timeoutMs: parsed.timeoutMs }),
  })

  if (!response.ok) return failureOutput(response)
  return {
    ok: true,
    url: response.result.url,
    markdown: response.result.markdown,
    markdownTruncated: response.result.markdownTruncated,
    title: response.result.title,
    description: response.result.description,
    statusCode: response.result.statusCode,
    contentType: response.result.contentType,
  }
}

export const firecrawlSearchTool = createTool({
  id: "firecrawlSearch",
  description:
    "Search the public web through Firecrawl. Use this when the agent needs to discover current URLs before reading pages. Returns bounded results with source URLs.",
  inputSchema: firecrawlSearchToolInputSchema,
  outputSchema: firecrawlSearchToolOutputSchema,
  execute: async (inputData) => executeFirecrawlSearchTool(inputData),
})

export const firecrawlScrapeTool = createTool({
  id: "firecrawlScrape",
  description:
    "Scrape a known public URL through Firecrawl and return bounded markdown plus safe metadata. Use this after a URL is known or selected from search results.",
  inputSchema: firecrawlScrapeToolInputSchema,
  outputSchema: firecrawlScrapeToolOutputSchema,
  execute: async (inputData) => executeFirecrawlScrapeTool(inputData),
})
