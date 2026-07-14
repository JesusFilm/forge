import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import {
  getDiscoverySourcesConfig,
  getFirecrawlConfig,
  getInstagramSiteIngestConfig,
  type FirecrawlConfig,
} from "../../config/env"
import {
  DISCOVERY_SOURCE_BUDGET_MS,
  DISCOVERY_SOURCE_CONCURRENCY,
  mapWithConcurrency,
} from "../../services/discovery/bounded-parallel"
import type { SourcesConfig } from "../../services/discovery/sources-client"
import {
  loadSavedSourceValuesResult,
  mergeUnique,
} from "../../services/discovery/saved-sources"
import {
  submitPostsToSite,
  SiteIngestError,
  type SiteIngestConfig,
  type SiteIngestResult,
} from "../../services/instagram-discovery/site-ingest-client"
import {
  ReviewQueueOutcomeSchema,
  type ReviewQueueOutcome,
} from "../../services/discovery/review-queue-outcome"
import {
  FirecrawlSearchError,
  requestFirecrawlSearch,
  type FirecrawlSearchHit,
  type RequestFirecrawlSearchOptions,
} from "../../services/firecrawl-search-client"
import {
  classifyPost,
  qualifies,
} from "../../services/instagram-discovery/classifier"
import { parseInstagramPost } from "../../services/instagram-discovery/post-parser"
import {
  DiscoveryQueryFailureSchema,
  DiscoveryTotalsSchema,
  InstagramPostSchema,
  createInstagramDiscoveryArtifactStore,
  type InstagramDiscoveryArtifactStore,
} from "../../services/instagram-discovery/artifacts"
import type {
  DiscoveryQueryFailure,
  DiscoveryReport,
  DiscoveryTotals,
  InstagramPost,
} from "../../services/instagram-discovery/types"
import { isValidServiceBearer } from "../../server/service-bearer"

const WORKFLOW_FAILURE_ERROR_PREFIX = "INSTAGRAM_DISCOVERY_WORKFLOW_FAILED:"

// No default keyword queries: on Instagram, open web-search queries return
// mostly news/commentary ABOUT AI + Christianity (Trump/Pope AI-image stories),
// not actual creations. The daily run relies on the saved trusted `handles`
// instead, which stay clean. An operator can still pass explicit `queries` for
// a one-off keyword sweep (those get the full AI + Christian + not-commentary
// filter).
const DEFAULT_QUERIES: string[] = []
const MAX_HANDLES = 50

export const InstagramDiscoveryWorkflowInputSchema = z
  .object({
    /** Trusted creator handles (e.g. "biblewithlife"); each becomes an
     * account-scoped Firecrawl search and is kept unless it reads as commentary. */
    handles: z.array(z.string().min(1)).max(MAX_HANDLES).default([]),
    queries: z.array(z.string().min(1)).max(20).default(DEFAULT_QUERIES),
    limitPerQuery: z.number().int().positive().max(50).default(10),
    scrapeMetadata: z.boolean().default(false),
    maxResults: z.number().int().positive().max(200).default(10),
    persistArtifact: z.boolean().default(true),
  })
  .strict()

/** Account-scoped web search query that biases results to one IG account. */
export function accountSearchQuery(handle: string): string {
  const clean = handle.trim().replace(/^@+/, "").replace(/\/+$/, "")
  return `site:instagram.com/${clean}`
}

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
    reviewQueue: ReviewQueueOutcomeSchema,
    artifactPath: z.string().optional(),
  })
  .strict()

const WorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum([
      "invalid_input",
      "config_missing",
      "sources_unavailable",
      "all_queries_failed",
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

// Step-boundary projection of FirecrawlSearchHit. Deliberately .strict() (vs the
// client's .passthrough()): searchStep maps each hit to exactly these fields, so
// unknown Firecrawl fields are intentionally dropped before crossing the Mastra
// serialization boundary.
const FirecrawlHitSchema = z
  .object({
    url: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    markdown: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

// A hit tagged by origin: `trusted` when it came from an account-scoped handle
// search (kept unless commentary) vs. a keyword query (full AI+Christian filter).
const TaggedHitSchema = z
  .object({ hit: FirecrawlHitSchema, trusted: z.boolean() })
  .strict()

type TaggedHit = { hit: FirecrawlSearchHit; trusted: boolean }

export type SearchQueryFn = (
  query: string,
  options: RequestFirecrawlSearchOptions,
) => Promise<FirecrawlSearchHit[]>

export type InstagramDiscoveryOptions = {
  runId?: string
  now?: () => Date
  firecrawlConfig?: FirecrawlConfig
  searchQuery?: SearchQueryFn
  artifactStore?: InstagramDiscoveryArtifactStore
  /** Explicit site-ingest config; falls back to env when omitted. null disables. */
  siteIngest?: SiteIngestConfig | null
  /** Injectable submit fn for tests; defaults to a real HTTP POST. */
  submitPosts?: (posts: InstagramPost[]) => Promise<SiteIngestResult>
  /** Saved-sources config; when set, the saved handles are merged into `handles`. */
  sourcesConfig?: SourcesConfig | null
  /** Injectable fetch for the saved-sources call (tests). */
  fetchSources?: typeof fetch
}

/**
 * Merge the website's saved Instagram handles into the run input (deduped).
 * The caller surfaces a failed source request when no fallback input exists.
 */
async function withSavedInstagramSources(
  input: InstagramDiscoveryWorkflowInput,
  options: { config?: SourcesConfig | null; fetchImpl?: typeof fetch },
): Promise<{
  input: InstagramDiscoveryWorkflowInput
  sourceLoadStatus: "not_configured" | "loaded" | "failed"
}> {
  const loaded = await loadSavedSourceValuesResult("instagram", options)
  return {
    input: {
      ...input,
      handles: mergeUnique(input.handles, loaded.values, MAX_HANDLES),
    },
    sourceLoadStatus: loaded.status,
  }
}

/**
 * Best-effort submit of qualified posts to the website review queue. Never
 * throws into the run — a site outage must not fail discovery. Logs the outcome
 * in the plain-string format the rest of the app uses.
 */
async function submitToReviewQueue(
  posts: readonly InstagramPost[],
  options: Pick<InstagramDiscoveryOptions, "siteIngest" | "submitPosts">,
): Promise<ReviewQueueOutcome> {
  if (posts.length === 0) return { status: "empty" }
  const config = options.siteIngest ?? getInstagramSiteIngestConfig()
  if (!options.submitPosts && !config) return { status: "not_configured" }
  try {
    const result = options.submitPosts
      ? await options.submitPosts([...posts])
      : config
        ? await submitPostsToSite(posts, config)
        : null
    if (result) {
      console.log(
        `[instagram-discovery] event=site_ingest inserted=${result.inserted} skipped=${result.skipped}`,
      )
      return {
        status: "submitted",
        inserted: result.inserted,
        skipped: result.skipped,
      }
    }
    return { status: "not_configured" }
  } catch (error) {
    console.error(
      `[instagram-discovery] event=site_ingest_failed message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return {
      status: "failed",
      reason: error instanceof SiteIngestError ? error.code : "upstream_failed",
    }
  }
}

class InstagramDiscoveryFailureError extends Error {
  constructor(readonly result: InstagramDiscoveryWorkflowFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "InstagramDiscoveryFailureError"
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
  hits: TaggedHit[]
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

  // Trusted handle searches first so they win dedup ties downstream.
  const sources: Array<{ query: string; trusted: boolean }> = [
    ...input.handles.map((handle) => ({
      query: accountSearchQuery(handle),
      trusted: true,
    })),
    ...input.queries.map((query) => ({ query, trusted: false })),
  ]
  const sourceSignal = AbortSignal.timeout(DISCOVERY_SOURCE_BUDGET_MS)

  const outcomes = await mapWithConcurrency(
    sources,
    DISCOVERY_SOURCE_CONCURRENCY,
    async (source) => {
      try {
        if (sourceSignal.aborted) {
          throw new FirecrawlSearchError(
            "upstream_failed",
            "Instagram discovery source deadline exceeded",
            true,
          )
        }
        const queryHits = await options.searchQuery(source.query, {
          apiKey: options.firecrawlConfig.apiKey,
          baseUrl: options.firecrawlConfig.apiUrl,
          timeoutMs: options.firecrawlConfig.timeoutMs,
          limit: Math.min(
            input.limitPerQuery,
            options.firecrawlConfig.maxSearchResults,
          ),
          maxMarkdownCharacters: options.firecrawlConfig.maxMarkdownCharacters,
          signal: sourceSignal,
          scrape: input.scrapeMetadata,
        })
        return {
          hits: queryHits.map((hit) => ({ hit, trusted: source.trusted })),
          failure: null,
          retryable: false,
        }
      } catch (error) {
        const code =
          error instanceof FirecrawlSearchError ? error.code : "search_failed"
        return {
          hits: [],
          failure: {
            query: source.query,
            code,
            message: error instanceof Error ? error.message : String(error),
          } satisfies DiscoveryQueryFailure,
          retryable:
            error instanceof FirecrawlSearchError ? error.retryable : false,
        }
      }
    },
  )

  const hits: TaggedHit[] = []
  const queryFailures: DiscoveryQueryFailure[] = []
  let anyRetryable = false
  for (const outcome of outcomes) {
    hits.push(...outcome.hits)
    if (outcome.failure) {
      queryFailures.push(outcome.failure)
      if (outcome.retryable) anyRetryable = true
    }
  }

  if (sources.length > 0 && queryFailures.length === sources.length) {
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
 * Parse Firecrawl hits into Instagram posts, drop non-Instagram results, dedupe
 * by shortcode, then keep posts by origin:
 *  - Trusted (account-scoped handle search): keep everything EXCEPT obvious
 *    commentary. No AI/Christian keyword requirement — you curated the handle.
 *  - Keyword search: full filter — must signal BOTH AI and Christian and not
 *    read as commentary.
 * Trusted hits are ordered first by the search step, so they win dedup ties.
 * Capped at `maxResults`.
 */
export function selectQualifyingPosts(
  hits: readonly TaggedHit[],
  input: InstagramDiscoveryWorkflowInput,
): { posts: InstagramPost[]; totals: DiscoveryTotals } {
  const parsed: Array<{ post: InstagramPost; trusted: boolean }> = []
  for (const { hit, trusted } of hits) {
    const post = parseInstagramPost(hit)
    if (post) parsed.push({ post, trusted })
  }

  const byShortcode = new Map<
    string,
    { post: InstagramPost; trusted: boolean }
  >()
  for (const entry of parsed) {
    if (!byShortcode.has(entry.post.shortcode)) {
      byShortcode.set(entry.post.shortcode, entry)
    }
  }
  const deduped = [...byShortcode.values()]

  const qualified: InstagramPost[] = []
  let excludedCommentary = 0
  for (const { post, trusted } of deduped) {
    const signals = classifyPost(post)
    const keep = trusted ? !signals.isCommentary : qualifies(signals)
    if (!keep) {
      // Count commentary drops: trusted posts dropped as commentary, plus search
      // posts that were AI + Christian but read as commentary.
      if (
        signals.isCommentary &&
        (trusted || (signals.isAiGenerated && signals.isChristian))
      ) {
        excludedCommentary += 1
      }
      continue
    }
    // Cap the kept set, but keep scanning so excludedCommentary counts every
    // commentary drop, not just those before the cap. Classification is cheap.
    if (qualified.length < input.maxResults) {
      qualified.push({
        ...post,
        matchedAi: signals.matchedAi,
        matchedChristian: signals.matchedChristian,
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
  const searchQuery = options.searchQuery ?? requestFirecrawlSearch
  const artifactStore =
    options.artifactStore ?? createInstagramDiscoveryArtifactStore()

  const parsedInput = InstagramDiscoveryWorkflowInputSchema.safeParse(rawInput)
  if (!parsedInput.success) {
    return failure("invalid_input", { mastraRunId, retryable: false })
  }
  const savedSources = await withSavedInstagramSources(parsedInput.data, {
    config: options.sourcesConfig,
    fetchImpl: options.fetchSources,
  })
  const input = savedSources.input
  if (
    savedSources.sourceLoadStatus === "failed" &&
    input.handles.length === 0 &&
    input.queries.length === 0
  ) {
    return failure("sources_unavailable", {
      mastraRunId,
      retryable: true,
      details: "saved Instagram sources could not be loaded",
    })
  }

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
      const written = await artifactStore.writeReport(report)
      artifactPath = written.path
    }

    const reviewQueue = await submitToReviewQueue(posts, options)

    return {
      ok: true,
      mastraRunId,
      totals,
      posts,
      queryFailures,
      reviewQueue,
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
      input: InstagramDiscoveryWorkflowInputSchema,
      startedAt: z.string(),
      hits: z.array(TaggedHitSchema),
      queryFailures: z.array(DiscoveryQueryFailureSchema),
    })
    .strict(),
  WorkflowFailureSchema,
])

const FilterStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      input: InstagramDiscoveryWorkflowInputSchema,
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
      const savedSources = await withSavedInstagramSources(inputData, {
        config: getDiscoverySourcesConfig(),
      })
      const input = savedSources.input
      if (
        savedSources.sourceLoadStatus === "failed" &&
        input.handles.length === 0 &&
        input.queries.length === 0
      ) {
        throwDiscoveryFailure(
          failure("sources_unavailable", {
            mastraRunId: runId,
            retryable: true,
            details: "saved Instagram sources could not be loaded",
          }),
        )
      }
      const { hits, queryFailures } = await searchInstagramCandidates(input, {
        runId,
        firecrawlConfig: getFirecrawlConfig(),
        searchQuery: requestFirecrawlSearch,
      })
      return {
        ok: true as const,
        input,
        startedAt,
        hits: hits.map(({ hit, trusted }) => ({
          hit: {
            url: hit.url,
            title: hit.title,
            description: hit.description,
            markdown: hit.markdown,
            metadata: hit.metadata,
          },
          trusted,
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
  execute: async ({ inputData }) => {
    if (!inputData.ok) throwDiscoveryFailure(inputData)
    const input = inputData.input
    const { posts, totals } = selectQualifyingPosts(inputData.hits, input)
    return {
      ok: true as const,
      input,
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
  execute: async ({ inputData, runId }) => {
    if (!inputData.ok) throwDiscoveryFailure(inputData)
    const input = inputData.input
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
      const written =
        await createInstagramDiscoveryArtifactStore().writeReport(report)
      artifactPath = written.path
    }

    const reviewQueue = await submitToReviewQueue(inputData.posts, {})

    return {
      ok: true as const,
      mastraRunId: runId,
      totals: inputData.totals,
      posts: inputData.posts,
      queryFailures: inputData.queryFailures,
      reviewQueue,
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

  const run = await instagramAiChristianDiscoveryWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      discoveryFailureFromUnknown(error) ??
      failure("all_queries_failed", { mastraRunId: runId, retryable: true })
    )
  }
  if (result.status === "success") return result.result
  return (
    discoveryFailureFromRunResult(result) ??
    failure("all_queries_failed", { mastraRunId: runId, retryable: true })
  )
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
  if (
    result.reason === "config_missing" ||
    result.reason === "sources_unavailable"
  ) {
    return 503
  }
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
      : await launch(body, { runId })

  return { status: routeStatusForResult(result), body: { result } }
}

export const _internals = {
  buildReport,
  discoveryFailureFromRunResult,
}
