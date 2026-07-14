import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import {
  getFirecrawlConfig,
  getInstagramSiteIngestConfig,
  type FirecrawlConfig,
} from "../../config/env"
import {
  searchFirecrawl,
  type FirecrawlSearchInput,
} from "../../services/firecrawl-client"
import {
  submitPostsToSite,
  type SiteIngestConfig,
  type SiteIngestResult,
} from "../../services/instagram-discovery/site-ingest-client"
import {
  classifyPost,
  qualifies,
} from "../../services/instagram-discovery/classifier"
import { parseInstagramPost } from "../../services/instagram-discovery/post-parser"
import {
  DiscoveryQueryFailureSchema,
  DiscoveryTotalsSchema,
  InstagramPostSchema,
  InstagramDiscoveryArtifactError,
  createInstagramDiscoveryArtifactStore,
  type InstagramDiscoveryArtifactStore,
} from "../../services/instagram-discovery/artifacts"
import type {
  DiscoveryQueryFailure,
  DiscoveryReport,
  DiscoveryTotals,
  InstagramPost,
} from "../../services/instagram-discovery/types"
import {
  MAX_DISCOVERY_TEXT_LENGTH,
  MAX_INSTAGRAM_HASHTAGS,
} from "../../services/instagram-discovery/types"
import { isValidServiceBearer } from "../../server/service-bearer"

const WORKFLOW_FAILURE_ERROR_PREFIX = "INSTAGRAM_DISCOVERY_WORKFLOW_FAILED:"

const DEFAULT_QUERIES = [
  "AI generated Jesus video site:instagram.com",
  "AI generated Christian reel site:instagram.com",
]
const DEFAULT_LIMIT_PER_QUERY = 5
const MAX_LIMIT_PER_QUERY = 20

export const InstagramDiscoveryWorkflowInputSchema = z
  .object({
    queries: z
      .array(z.string().trim().min(1).max(MAX_DISCOVERY_TEXT_LENGTH))
      .min(1)
      .max(20)
      .default(DEFAULT_QUERIES),
    limitPerQuery: z
      .number()
      .int()
      .positive()
      .max(MAX_LIMIT_PER_QUERY)
      .default(DEFAULT_LIMIT_PER_QUERY),
    scrapeMetadata: z.boolean().default(false),
    maxResults: z.number().int().positive().max(200).default(50),
    persistArtifact: z.boolean().default(true),
  })
  .strict()

export type InstagramDiscoveryWorkflowInput = z.infer<
  typeof InstagramDiscoveryWorkflowInputSchema
>

const WorkflowSuccessSchema = z
  .object({
    ok: z.literal(true),
    mastraRunId: z.string(),
    totals: DiscoveryTotalsSchema,
    posts: z.array(InstagramPostSchema),
    queryFailures: z.array(DiscoveryQueryFailureSchema),
    artifactPath: z.string().optional(),
  })
  .strict()

const WorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum([
      "invalid_input",
      "config_missing",
      "all_queries_failed",
      "artifact_failed",
    ]),
    retryable: z.boolean(),
    mastraRunId: z.string(),
    details: z.string().optional(),
  })
  .strict()

export const InstagramDiscoveryWorkflowOutputSchema = z.discriminatedUnion(
  "ok",
  [WorkflowSuccessSchema, WorkflowFailureSchema],
)

export type InstagramDiscoveryWorkflowResult = z.infer<
  typeof InstagramDiscoveryWorkflowOutputSchema
>
type InstagramDiscoveryWorkflowFailure = z.infer<typeof WorkflowFailureSchema>
type InstagramDiscoveryWorkflowSuccess = z.infer<typeof WorkflowSuccessSchema>

export type InstagramDiscoverySearchHit = {
  url: string
  title?: string | null
  description?: string | null
  markdown?: string | null
  metadata?: Record<string, unknown>
}

type DedupeCandidate = {
  post: InstagramPost
  matchedAi: string[]
  matchedChristian: string[]
  matchedCommentary: string[]
}

// Step-boundary projection of Firecrawl results. Deliberately .strict():
// searchStep maps each hit to exactly these fields, so unknown upstream fields
// are intentionally dropped before crossing the Mastra serialization boundary.
const FirecrawlHitSchema = z
  .object({
    url: z.string().max(512),
    title: z.string().max(MAX_DISCOVERY_TEXT_LENGTH).nullable().optional(),
    description: z
      .string()
      .max(MAX_DISCOVERY_TEXT_LENGTH)
      .nullable()
      .optional(),
    markdown: z.string().max(MAX_DISCOVERY_TEXT_LENGTH).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export type SearchQueryFn = (
  query: string,
  options: {
    firecrawlConfig: FirecrawlConfig
    includeMarkdown: boolean
    limit: number
  },
) => Promise<InstagramDiscoverySearchHit[]>

export type InstagramDiscoveryOptions = {
  runId?: string
  now?: () => Date
  firecrawlConfig?: FirecrawlConfig
  searchQuery?: SearchQueryFn
  artifactStore?: InstagramDiscoveryArtifactStore
  siteIngest?: SiteIngestConfig | null
  submitPosts?: (posts: InstagramPost[]) => Promise<SiteIngestResult>
}

async function submitToReviewQueue(
  posts: readonly InstagramPost[],
  options: Pick<InstagramDiscoveryOptions, "siteIngest" | "submitPosts">,
): Promise<void> {
  if (posts.length === 0 || options.siteIngest === null) return

  const config = options.siteIngest ?? getInstagramSiteIngestConfig()
  if (!config && !options.submitPosts) return

  try {
    const result = options.submitPosts
      ? await options.submitPosts([...posts])
      : await submitPostsToSite(posts, config!)
    console.log(
      `[instagram-discovery] event=site_ingest inserted=${result.inserted} skipped=${result.skipped}`,
    )
  } catch (error) {
    console.error(
      `[instagram-discovery] event=site_ingest_failed message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

class InstagramDiscoveryFailureError extends Error {
  constructor(readonly result: InstagramDiscoveryWorkflowFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "InstagramDiscoveryFailureError"
  }
}

export class InstagramDiscoverySearchError extends Error {
  constructor(
    readonly code: DiscoveryQueryFailure["code"],
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = "InstagramDiscoverySearchError"
  }
}

function failure(
  reason: InstagramDiscoveryWorkflowFailure["reason"],
  options: { mastraRunId: string; retryable: boolean; details?: string },
): InstagramDiscoveryWorkflowFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    mastraRunId: options.mastraRunId,
    details: options.details,
  }
}

function throwDiscoveryFailure(
  result: InstagramDiscoveryWorkflowFailure,
): never {
  throw new InstagramDiscoveryFailureError(result)
}

function artifactFailure(
  error: unknown,
  mastraRunId: string,
): InstagramDiscoveryWorkflowFailure {
  const retryable =
    !(error instanceof InstagramDiscoveryArtifactError) ||
    error.code === "write_failed" ||
    error.code === "read_failed"
  return failure("artifact_failed", {
    mastraRunId,
    retryable,
    details: error instanceof Error ? error.message : String(error),
  })
}

function boundedText(value: string): string {
  if (value.length <= MAX_DISCOVERY_TEXT_LENGTH) return value
  return `${value.slice(0, MAX_DISCOVERY_TEXT_LENGTH - 3)}...`
}

function boundedOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null
  return boundedText(value)
}

function sanitizeSearchHit(
  hit: InstagramDiscoverySearchHit,
): InstagramDiscoverySearchHit {
  return {
    url: hit.url.slice(0, 512),
    title: boundedOptionalText(hit.title),
    description: boundedOptionalText(hit.description),
    markdown: boundedOptionalText(hit.markdown),
    metadata: hit.metadata,
  }
}

function discoveryFailureFromUnknown(
  value: unknown,
): InstagramDiscoveryWorkflowFailure | null {
  if (value instanceof InstagramDiscoveryFailureError) return value.result

  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : typeof value === "object" && value !== null && "message" in value
          ? String((value as { message?: unknown }).message ?? "")
          : ""

  const prefixIndex = message.indexOf(WORKFLOW_FAILURE_ERROR_PREFIX)
  if (prefixIndex < 0) return null
  try {
    const parsed = WorkflowFailureSchema.safeParse(
      JSON.parse(
        message.slice(prefixIndex + WORKFLOW_FAILURE_ERROR_PREFIX.length),
      ),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function discoveryFailureFromRunResult(
  value: unknown,
): InstagramDiscoveryWorkflowFailure | null {
  const direct = discoveryFailureFromUnknown(value)
  if (direct) return direct
  if (value === null || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return (
    discoveryFailureFromUnknown(record.error) ??
    discoveryFailureFromUnknown(record.result) ??
    discoveryFailureFromUnknown(record.snapshot)
  )
}

async function requestInstagramDiscoverySearch(
  query: string,
  options: {
    firecrawlConfig: FirecrawlConfig
    includeMarkdown: boolean
    limit: number
  },
): Promise<InstagramDiscoverySearchHit[]> {
  const response = await searchFirecrawl({
    query,
    limit: options.limit,
    includeMarkdown: options.includeMarkdown,
    config: options.firecrawlConfig,
  } satisfies FirecrawlSearchInput)

  if (!response.ok) {
    throw new InstagramDiscoverySearchError(
      response.reason,
      response.upstreamReason ?? `Firecrawl search failed: ${response.reason}`,
      response.retryable,
    )
  }

  return response.result.results.map((hit) => ({
    url: hit.url,
    title: hit.title,
    description: hit.description,
    markdown: hit.markdown,
  }))
}

/**
 * Run each query through Firecrawl search. Tolerant to per-query failures:
 * collects them and only fails the whole run when every query errors. Throws
 * `config_missing` when no Firecrawl API key is configured.
 */
export async function searchInstagramCandidates(
  input: InstagramDiscoveryWorkflowInput,
  options: {
    runId: string
    firecrawlConfig: FirecrawlConfig
    searchQuery: SearchQueryFn
  },
): Promise<{
  hits: InstagramDiscoverySearchHit[]
  queryFailures: DiscoveryQueryFailure[]
}> {
  if (!options.firecrawlConfig.apiKey) {
    throwDiscoveryFailure(
      failure("config_missing", {
        mastraRunId: options.runId,
        retryable: false,
        details: "FIRECRAWL_API_KEY is not configured",
      }),
    )
  }

  const hits: InstagramDiscoverySearchHit[] = []
  const queryFailures: DiscoveryQueryFailure[] = []
  let anyRetryable = false

  for (const query of input.queries) {
    try {
      const queryHits = await options.searchQuery(query, {
        firecrawlConfig: options.firecrawlConfig,
        limit: input.limitPerQuery,
        includeMarkdown: input.scrapeMetadata,
      })
      hits.push(...queryHits.map(sanitizeSearchHit))
    } catch (error) {
      const code =
        error instanceof InstagramDiscoverySearchError
          ? error.code
          : "search_failed"
      if (error instanceof InstagramDiscoverySearchError && error.retryable) {
        anyRetryable = true
      }
      queryFailures.push({
        query,
        code,
        message: boundedText(
          error instanceof Error ? error.message : String(error),
        ),
      })
    }
  }

  if (
    input.queries.length > 0 &&
    queryFailures.length === input.queries.length
  ) {
    throwDiscoveryFailure(
      failure("all_queries_failed", {
        mastraRunId: options.runId,
        retryable: anyRetryable,
        details: queryFailures.map((entry) => entry.code).join(","),
      }),
    )
  }

  return { hits, queryFailures }
}

/**
 * Parse Firecrawl hits into Instagram posts, drop non-Instagram results,
 * dedupe by shortcode, classify, and keep only posts that signal BOTH
 * AI-generation and Christian content without reading as commentary
 * (capped at `maxResults`).
 */
export function selectQualifyingPosts(
  hits: readonly InstagramDiscoverySearchHit[],
  input: InstagramDiscoveryWorkflowInput,
): { posts: InstagramPost[]; totals: DiscoveryTotals } {
  const parsed: InstagramPost[] = []
  for (const hit of hits) {
    const post = parseInstagramPost(hit)
    if (post) parsed.push(post)
  }

  const byShortcode = new Map<string, DedupeCandidate>()
  for (const post of parsed) {
    const signals = classifyPost(post)
    const existing = byShortcode.get(post.shortcode)
    byShortcode.set(
      post.shortcode,
      existing
        ? {
            post: mergeDuplicatePost(existing.post, post),
            matchedAi: mergeStrings(existing.matchedAi, signals.matchedAi, 64),
            matchedChristian: mergeStrings(
              existing.matchedChristian,
              signals.matchedChristian,
              64,
            ),
            matchedCommentary: mergeStrings(
              existing.matchedCommentary,
              signals.matchedCommentary,
              64,
            ),
          }
        : {
            post,
            matchedAi: signals.matchedAi,
            matchedChristian: signals.matchedChristian,
            matchedCommentary: signals.matchedCommentary,
          },
    )
  }
  const deduped = [...byShortcode.values()]

  const qualified: InstagramPost[] = []
  let excludedCommentary = 0
  for (const {
    post,
    matchedAi,
    matchedChristian,
    matchedCommentary,
  } of deduped) {
    const signals = {
      isAiGenerated: matchedAi.length > 0,
      isChristian: matchedChristian.length > 0,
      isCommentary: matchedCommentary.length > 0,
      matchedAi,
      matchedChristian,
      matchedCommentary,
    }

    if (!qualifies(signals)) {
      if (
        signals.isAiGenerated &&
        signals.isChristian &&
        signals.isCommentary
      ) {
        excludedCommentary += 1
      }
      continue
    }

    if (qualified.length < input.maxResults) {
      qualified.push({
        ...post,
        matchedAi,
        matchedChristian,
      })
    }
  }

  return {
    posts: qualified,
    totals: {
      candidates: hits.length,
      instagram: parsed.length,
      deduped: deduped.length,
      excludedCommentary,
      qualified: qualified.length,
    },
  }
}

function mergeDuplicatePost(
  existing: InstagramPost,
  next: InstagramPost,
): InstagramPost {
  return {
    ...existing,
    authorHandle: existing.authorHandle ?? next.authorHandle,
    authorName: existing.authorName ?? next.authorName,
    caption: mergeText(existing.caption, next.caption),
    hashtags: mergeStrings(
      existing.hashtags,
      next.hashtags,
      MAX_INSTAGRAM_HASHTAGS,
    ),
    publishedAt: existing.publishedAt ?? next.publishedAt,
    thumbnailUrl: existing.thumbnailUrl ?? next.thumbnailUrl,
  }
}

function mergeText(first: string, second: string): string {
  if (first.includes(second)) return first
  if (second.includes(first)) return second.slice(0, MAX_DISCOVERY_TEXT_LENGTH)
  return `${first}\n${second}`.slice(0, MAX_DISCOVERY_TEXT_LENGTH)
}

function mergeStrings(
  first: readonly string[],
  second: readonly string[],
  maxItems: number,
): string[] {
  return [...new Set([...first, ...second])].slice(0, maxItems)
}

function buildReport(args: {
  runId: string
  startedAt: string
  finishedAt: string
  queries: string[]
  totals: DiscoveryTotals
  queryFailures: DiscoveryQueryFailure[]
  posts: InstagramPost[]
}): DiscoveryReport {
  return {
    schemaVersion: "1",
    kind: "instagram-ai-christian-discovery",
    reportId: args.runId,
    mastraRunId: args.runId,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    queries: args.queries,
    totals: args.totals,
    queryFailures: args.queryFailures,
    posts: args.posts,
  }
}

/**
 * Core orchestration — fully injectable, used by both the route handler path
 * and unit tests. Returns a discriminated-union result rather than throwing.
 */
export async function runInstagramDiscovery(
  rawInput: unknown,
  options: InstagramDiscoveryOptions = {},
): Promise<InstagramDiscoveryWorkflowResult> {
  const mastraRunId = options.runId ?? randomUUID()
  const now = options.now ?? (() => new Date())
  const firecrawlConfig = options.firecrawlConfig ?? getFirecrawlConfig()
  const searchQuery = options.searchQuery ?? requestInstagramDiscoverySearch
  const artifactStore =
    options.artifactStore ?? createInstagramDiscoveryArtifactStore()

  const parsedInput = InstagramDiscoveryWorkflowInputSchema.safeParse(rawInput)
  if (!parsedInput.success) {
    return failure("invalid_input", { mastraRunId, retryable: false })
  }
  const input = parsedInput.data

  const startedAt = now().toISOString()
  try {
    const { hits, queryFailures } = await searchInstagramCandidates(input, {
      runId: mastraRunId,
      firecrawlConfig,
      searchQuery,
    })
    const { posts, totals } = selectQualifyingPosts(hits, input)
    const finishedAt = now().toISOString()

    let artifactPath: string | undefined
    if (input.persistArtifact) {
      const report = buildReport({
        runId: mastraRunId,
        startedAt,
        finishedAt,
        queries: input.queries,
        totals,
        queryFailures,
        posts,
      })
      const written = await artifactStore
        .writeReport(report)
        .catch((error: unknown) => {
          throwDiscoveryFailure(artifactFailure(error, mastraRunId))
        })
      artifactPath = written.path
    }

    await submitToReviewQueue(posts, options)

    return {
      ok: true,
      mastraRunId,
      totals,
      posts,
      queryFailures,
      ...(artifactPath ? { artifactPath } : {}),
    } satisfies InstagramDiscoveryWorkflowSuccess
  } catch (error) {
    return (
      discoveryFailureFromUnknown(error) ??
      failure("all_queries_failed", {
        mastraRunId,
        retryable: true,
        details: error instanceof Error ? error.message : String(error),
      })
    )
  }
}

// --- Mastra workflow (Studio-facing) ---------------------------------------

const SearchStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      startedAt: z.string(),
      hits: z.array(FirecrawlHitSchema),
      queryFailures: z.array(DiscoveryQueryFailureSchema),
    })
    .strict(),
  WorkflowFailureSchema,
])

const FilterStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      startedAt: z.string(),
      posts: z.array(InstagramPostSchema),
      totals: DiscoveryTotalsSchema,
      queryFailures: z.array(DiscoveryQueryFailureSchema),
    })
    .strict(),
  WorkflowFailureSchema,
])

const searchStep = createStep({
  id: "search-instagram-candidates",
  description:
    "Run Firecrawl search for each query and collect candidate hits.",
  inputSchema: InstagramDiscoveryWorkflowInputSchema,
  outputSchema: SearchStepOutputSchema,
  execute: async ({ inputData, runId }) => {
    const startedAt = new Date().toISOString()
    try {
      const { hits, queryFailures } = await searchInstagramCandidates(
        inputData,
        {
          runId,
          firecrawlConfig: getFirecrawlConfig(),
          searchQuery: requestInstagramDiscoverySearch,
        },
      )
      return {
        ok: true as const,
        startedAt,
        hits: hits.map((hit) => ({
          url: hit.url,
          title: hit.title,
          description: hit.description,
          markdown: hit.markdown,
          metadata: hit.metadata,
        })),
        queryFailures,
      }
    } catch (error) {
      const parsed = discoveryFailureFromUnknown(error)
      if (parsed) throwDiscoveryFailure(parsed)
      throw error
    }
  },
})

const filterStep = createStep({
  id: "parse-and-filter-posts",
  description:
    "Parse Instagram hits, dedupe by shortcode, and keep qualifying posts.",
  inputSchema: SearchStepOutputSchema,
  outputSchema: FilterStepOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok) throwDiscoveryFailure(inputData)
    const input =
      InstagramDiscoveryWorkflowInputSchema.parse(getInitData<unknown>())
    const { posts, totals } = selectQualifyingPosts(inputData.hits, input)
    return {
      ok: true as const,
      startedAt: inputData.startedAt,
      posts,
      totals,
      queryFailures: inputData.queryFailures,
    }
  },
})

const reportStep = createStep({
  id: "report-and-persist",
  description: "Build the discovery report and persist it when requested.",
  inputSchema: FilterStepOutputSchema,
  outputSchema: InstagramDiscoveryWorkflowOutputSchema,
  execute: async ({ inputData, getInitData, runId }) => {
    if (!inputData.ok) throwDiscoveryFailure(inputData)
    const input =
      InstagramDiscoveryWorkflowInputSchema.parse(getInitData<unknown>())
    const finishedAt = new Date().toISOString()

    let artifactPath: string | undefined
    if (input.persistArtifact) {
      const report = buildReport({
        runId,
        startedAt: inputData.startedAt,
        finishedAt,
        queries: input.queries,
        totals: inputData.totals,
        queryFailures: inputData.queryFailures,
        posts: inputData.posts,
      })
      const written = await createInstagramDiscoveryArtifactStore()
        .writeReport(report)
        .catch((error: unknown) => {
          throwDiscoveryFailure(artifactFailure(error, runId))
        })
      artifactPath = written.path
    }

    await submitToReviewQueue(inputData.posts, {})

    return {
      ok: true as const,
      mastraRunId: runId,
      totals: inputData.totals,
      posts: inputData.posts,
      queryFailures: inputData.queryFailures,
      ...(artifactPath ? { artifactPath } : {}),
    }
  },
})

export const instagramAiChristianDiscoveryWorkflow = createWorkflow({
  id: "instagram-ai-christian-discovery",
  description:
    "Discover AI-generated Christian videos on Instagram via Firecrawl web search.",
  inputSchema: InstagramDiscoveryWorkflowInputSchema,
  outputSchema: InstagramDiscoveryWorkflowOutputSchema,
  schedule: {
    cron: "0 0 * * *",
    timezone: "UTC",
  },
})
  .then(searchStep)
  .then(filterStep)
  .then(reportStep)
  .commit()

export async function launchInstagramDiscoveryWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<InstagramDiscoveryWorkflowResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = InstagramDiscoveryWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", { mastraRunId: runId, retryable: false })
  }

  try {
    const run = await instagramAiChristianDiscoveryWorkflow.createRun({ runId })
    const result = await run.start({ inputData: parsed.data })
    if (result.status === "success") return result.result
    return (
      discoveryFailureFromRunResult(result) ??
      failure("all_queries_failed", { mastraRunId: runId, retryable: true })
    )
  } catch (error) {
    return (
      discoveryFailureFromUnknown(error) ??
      failure("all_queries_failed", {
        mastraRunId: runId,
        retryable: true,
        details: error instanceof Error ? error.message : String(error),
      })
    )
  }
}

// --- Route handler ----------------------------------------------------------

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<InstagramDiscoveryWorkflowResult>
}

export type InstagramDiscoveryRouteOutcome = {
  status: number
  body: { result?: InstagramDiscoveryWorkflowResult; error?: string }
}

function routeStatusForResult(
  result: InstagramDiscoveryWorkflowResult,
): number {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "config_missing") return 503
  if (result.reason === "artifact_failed") return 500
  return 502
}

export async function handleInstagramDiscoveryRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchInstagramDiscoveryWorkflow,
}: RouteHandlerInput): Promise<InstagramDiscoveryRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return { status: 401, body: { error: "Service bearer required" } }
  }

  const runId = randomUUID()
  const body = await readJson().catch(() => undefined)
  const result =
    body === undefined
      ? failure("invalid_input", { mastraRunId: runId, retryable: false })
      : await launch(body, { runId }).catch((error: unknown) =>
          failure("all_queries_failed", {
            mastraRunId: runId,
            retryable: true,
            details: error instanceof Error ? error.message : String(error),
          }),
        )

  return { status: routeStatusForResult(result), body: { result } }
}

export const _internals = {
  buildReport,
  discoveryFailureFromRunResult,
}
