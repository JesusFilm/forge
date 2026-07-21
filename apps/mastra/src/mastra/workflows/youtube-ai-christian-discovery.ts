import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import {
  getDiscoverySiteIngestConfig,
  getDiscoverySourcesConfig,
  getYouTubeConfig,
  type YouTubeConfig,
} from "../../config/env"
import {
  DISCOVERY_SOURCE_BUDGET_MS,
  DISCOVERY_SOURCE_CONCURRENCY,
  mapWithConcurrency,
} from "../../services/discovery/bounded-parallel"
import { classifyContent, qualifies } from "../../services/discovery/classifier"
import type { DiscoveredVideo } from "../../services/discovery/candidate"
import type { SourcesConfig } from "../../services/discovery/sources-client"
import {
  ReviewQueueOutcomeSchema,
  type ReviewQueueOutcome,
} from "../../services/discovery/review-queue-outcome"
import {
  loadSavedSourceValuesResult,
  mergeUnique,
  normalizeYouTubeSource,
} from "../../services/discovery/saved-sources"
import {
  SiteIngestError,
  submitCandidatesToSite,
  type SiteIngestConfig,
  type SiteIngestResult,
} from "../../services/discovery/site-ingest-client"
import { parseYouTubeVideo } from "../../services/youtube-discovery/post-parser"
import {
  DiscoverySourceFailureSchema,
  YouTubeDiscoveryTotalsSchema,
  YouTubeVideoSchema,
  createYouTubeDiscoveryArtifactStore,
  type YouTubeDiscoveryArtifactStore,
} from "../../services/youtube-discovery/artifacts"
import type {
  DiscoverySourceFailure,
  YouTubeDiscoveryReport,
  YouTubeDiscoveryTotals,
  YouTubeRawItem,
  YouTubeVideo,
} from "../../services/youtube-discovery/types"
import {
  YouTubeSearchError,
  listPlaylistVideos,
  resolveUploadsPlaylist,
  searchVideos,
} from "../../services/youtube-search-client"
import { isValidServiceBearer } from "../../server/service-bearer"

const WORKFLOW_FAILURE_ERROR_PREFIX = "YOUTUBE_DISCOVERY_WORKFLOW_FAILED:"

// Creation-oriented defaults: bias toward AI-made films/animation rather than
// generic "video", which pulls in commentary, news, and memes about AI.
const DEFAULT_QUERIES = [
  "AI generated Bible story film",
  "cinematic AI Jesus short film",
  "AI animated gospel story",
]
const MAX_CHANNELS = 50
const MAX_PLAYLISTS = 50

export const YouTubeDiscoveryWorkflowInputSchema = z
  .object({
    channels: z.array(z.string().min(1)).max(MAX_CHANNELS).default([]),
    playlists: z.array(z.string().min(1)).max(MAX_PLAYLISTS).default([]),
    queries: z.array(z.string().min(1)).max(20).default(DEFAULT_QUERIES),
    limitPerChannel: z.number().int().positive().max(50).default(10),
    limitPerPlaylist: z.number().int().positive().max(50).default(10),
    limitPerQuery: z.number().int().positive().max(50).default(10),
    maxResults: z.number().int().positive().max(200).default(10),
    persistArtifact: z.boolean().default(true),
  })
  .strict()

export type YouTubeDiscoveryWorkflowInput = z.infer<
  typeof YouTubeDiscoveryWorkflowInputSchema
>

const WorkflowSuccessSchema = z
  .object({
    ok: z.literal(true),
    mastraRunId: z.string(),
    totals: YouTubeDiscoveryTotalsSchema,
    videos: z.array(YouTubeVideoSchema),
    sourceFailures: z.array(DiscoverySourceFailureSchema),
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
      "all_sources_failed",
    ]),
    retryable: z.boolean(),
    mastraRunId: z.string(),
    details: z.string().optional(),
  })
  .strict()

export const YouTubeDiscoveryWorkflowOutputSchema = z.discriminatedUnion("ok", [
  WorkflowSuccessSchema,
  WorkflowFailureSchema,
])

export type YouTubeDiscoveryWorkflowResult = z.infer<
  typeof YouTubeDiscoveryWorkflowOutputSchema
>
type YouTubeDiscoveryWorkflowFailure = z.infer<typeof WorkflowFailureSchema>
type YouTubeDiscoveryWorkflowSuccess = z.infer<typeof WorkflowSuccessSchema>

// Raw YouTube items cross the Mastra step boundary as opaque records; the parser
// understands their shape on the far side. Each item is tagged `trusted` when it
// came from a curated channel/playlist (vs. a keyword search), which decides how
// strictly it is filtered downstream.
const RawItemSchema = z.record(z.string(), z.unknown())
const TaggedRawItemSchema = z
  .object({ raw: RawItemSchema, trusted: z.boolean() })
  .strict()

/** A raw item plus whether it came from a trusted (curated) source. */
type TaggedRawItem = { raw: YouTubeRawItem; trusted: boolean }

export type YouTubeClient = {
  searchVideos: typeof searchVideos
  resolveUploadsPlaylist: typeof resolveUploadsPlaylist
  listPlaylistVideos: typeof listPlaylistVideos
}

const defaultYouTubeClient: YouTubeClient = {
  searchVideos,
  resolveUploadsPlaylist,
  listPlaylistVideos,
}

export type YouTubeDiscoveryOptions = {
  runId?: string
  now?: () => Date
  youtubeConfig?: YouTubeConfig
  client?: YouTubeClient
  artifactStore?: YouTubeDiscoveryArtifactStore
  /** Explicit site-ingest config; falls back to env when omitted. null disables. */
  siteIngest?: SiteIngestConfig | null
  /** Injectable submit fn for tests; defaults to a real HTTP POST. */
  submitVideos?: (videos: DiscoveredVideo[]) => Promise<SiteIngestResult>
  /** Saved-sources config; when set, the saved list is merged into channels/playlists. */
  sourcesConfig?: SourcesConfig | null
  /** Injectable fetch for the saved-sources call (tests). */
  fetchSources?: typeof fetch
}

/**
 * Merge the website's saved YouTube sources into the run input: each saved value
 * is classified as a channel or a playlist and added to the matching trusted
 * list (deduped). The caller surfaces a failed source request when no fallback
 * input exists.
 */
async function withSavedYouTubeSources(
  input: YouTubeDiscoveryWorkflowInput,
  options: { config?: SourcesConfig | null; fetchImpl?: typeof fetch },
): Promise<{
  input: YouTubeDiscoveryWorkflowInput
  sourceLoadStatus: "not_configured" | "loaded" | "failed"
}> {
  const loaded = await loadSavedSourceValuesResult("youtube", options)
  const savedChannels: string[] = []
  const savedPlaylists: string[] = []
  const inputChannels: string[] = []
  const inputPlaylists: string[] = []

  for (const value of input.channels) {
    const trimmed = value.trim()
    if (!/^https?:\/\//i.test(trimmed)) {
      inputChannels.push(trimmed)
      continue
    }
    const normalized = normalizeYouTubeSource(trimmed)
    if (normalized?.kind === "channel") inputChannels.push(normalized.value)
  }
  for (const value of input.playlists) {
    const trimmed = value.trim()
    if (!/^https?:\/\//i.test(trimmed)) {
      inputPlaylists.push(trimmed)
      continue
    }
    const normalized = normalizeYouTubeSource(trimmed)
    if (normalized?.kind === "playlist") inputPlaylists.push(normalized.value)
  }
  for (const value of loaded.values) {
    const normalized = normalizeYouTubeSource(value)
    if (normalized?.kind === "playlist") savedPlaylists.push(normalized.value)
    if (normalized?.kind === "channel") savedChannels.push(normalized.value)
  }

  return {
    input: {
      ...input,
      channels: mergeUnique(inputChannels, savedChannels, MAX_CHANNELS),
      playlists: mergeUnique(inputPlaylists, savedPlaylists, MAX_PLAYLISTS),
    },
    sourceLoadStatus: loaded.status,
  }
}

function toCandidate(video: YouTubeVideo): DiscoveredVideo {
  return {
    platform: "youtube",
    externalId: video.videoId,
    url: video.url,
    caption: video.title,
    authorHandle: video.channelTitle,
    authorName: video.channelTitle,
    authorUrl: video.authorUrl,
    thumbnailUrl: video.thumbnailUrl,
    matchedAi: video.matchedAi,
    matchedChristian: video.matchedChristian,
  }
}

/**
 * Best-effort submit of qualified videos to the website review queue. Never
 * throws into the run — a site outage must not fail discovery.
 */
async function submitToReviewQueue(
  videos: readonly YouTubeVideo[],
  options: Pick<YouTubeDiscoveryOptions, "siteIngest" | "submitVideos">,
): Promise<ReviewQueueOutcome> {
  if (videos.length === 0) return { status: "empty" }
  const candidates = videos.map(toCandidate)
  const config = options.siteIngest ?? getDiscoverySiteIngestConfig()
  if (!options.submitVideos && !config) return { status: "not_configured" }
  try {
    const result = options.submitVideos
      ? await options.submitVideos(candidates)
      : config
        ? await submitCandidatesToSite(candidates, config)
        : null
    if (result) {
      console.log(
        `[youtube-discovery] event=site_ingest inserted=${result.inserted} skipped=${result.skipped}`,
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
      `[youtube-discovery] event=site_ingest_failed message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return {
      status: "failed",
      reason: error instanceof SiteIngestError ? error.code : "upstream_failed",
    }
  }
}

class YouTubeDiscoveryFailureError extends Error {
  constructor(readonly result: YouTubeDiscoveryWorkflowFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "YouTubeDiscoveryFailureError"
  }
}

function failure(
  reason: YouTubeDiscoveryWorkflowFailure["reason"],
  options: { mastraRunId: string; retryable: boolean; details?: string },
): YouTubeDiscoveryWorkflowFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    mastraRunId: options.mastraRunId,
    details: options.details,
  }
}

function throwDiscoveryFailure(result: YouTubeDiscoveryWorkflowFailure): never {
  throw new YouTubeDiscoveryFailureError(result)
}

function discoveryFailureFromUnknown(
  value: unknown,
): YouTubeDiscoveryWorkflowFailure | null {
  if (value instanceof YouTubeDiscoveryFailureError) return value.result

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
): YouTubeDiscoveryWorkflowFailure | null {
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

function sourceFailureFrom(
  source: string,
  kind: DiscoverySourceFailure["kind"],
  error: unknown,
): { failure: DiscoverySourceFailure; retryable: boolean } {
  const code =
    error instanceof YouTubeSearchError ? error.code : "source_failed"
  const retryable = error instanceof YouTubeSearchError && error.retryable
  return {
    failure: {
      source,
      kind,
      code,
      message: error instanceof Error ? error.message : String(error),
    },
    retryable,
  }
}

/**
 * Collect raw video items from trusted channels (uploads playlist) and keyword
 * searches. Tolerant to per-source failures: only fails the whole run when every
 * source errors. Throws `config_missing` when no YouTube API key is configured.
 */
export async function collectYouTubeCandidates(
  input: YouTubeDiscoveryWorkflowInput,
  options: {
    runId: string
    youtubeConfig: YouTubeConfig
    client: YouTubeClient
  },
): Promise<{
  items: TaggedRawItem[]
  sourceFailures: DiscoverySourceFailure[]
}> {
  if (!options.youtubeConfig.apiKey) {
    throwDiscoveryFailure(
      failure("config_missing", {
        mastraRunId: options.runId,
        retryable: false,
        details: "YOUTUBE_API_KEY is not configured",
      }),
    )
  }

  const requestOptions = {
    apiKey: options.youtubeConfig.apiKey,
    baseUrl: options.youtubeConfig.baseUrl,
    timeoutMs: options.youtubeConfig.timeoutMs,
    signal: AbortSignal.timeout(DISCOVERY_SOURCE_BUDGET_MS),
  }
  // Trusted (curated) sources are ordered first so they win dedup ties even
  // though the requests themselves are handled concurrently.
  const sources: Array<{
    source: string
    kind: DiscoverySourceFailure["kind"]
  }> = [
    ...input.channels.map((source) => ({ source, kind: "channel" as const })),
    ...input.playlists.map((source) => ({ source, kind: "playlist" as const })),
    ...input.queries.map((source) => ({ source, kind: "query" as const })),
  ]
  const outcomes = await mapWithConcurrency(
    sources,
    DISCOVERY_SOURCE_CONCURRENCY,
    async ({ source, kind }) => {
      try {
        if (requestOptions.signal.aborted) {
          throw new YouTubeSearchError(
            "upstream_failed",
            "YouTube discovery source deadline exceeded",
            true,
          )
        }
        let rawItems: YouTubeRawItem[]
        if (kind === "channel") {
          const uploads = await options.client.resolveUploadsPlaylist(
            source,
            requestOptions,
          )
          rawItems = await options.client.listPlaylistVideos(uploads, {
            ...requestOptions,
            limit: input.limitPerChannel,
          })
        } else if (kind === "playlist") {
          rawItems = await options.client.listPlaylistVideos(source, {
            ...requestOptions,
            limit: input.limitPerPlaylist,
          })
        } else {
          rawItems = await options.client.searchVideos(source, {
            ...requestOptions,
            limit: input.limitPerQuery,
          })
        }
        return {
          items: rawItems.map((raw) => ({ raw, trusted: kind !== "query" })),
          failure: null,
          retryable: false,
        }
      } catch (error) {
        const { failure: sourceFailure, retryable } = sourceFailureFrom(
          source,
          kind,
          error,
        )
        return { items: [], failure: sourceFailure, retryable }
      }
    },
  )

  const items: TaggedRawItem[] = []
  const sourceFailures: DiscoverySourceFailure[] = []
  let anyRetryable = false
  for (const outcome of outcomes) {
    items.push(...outcome.items)
    if (outcome.failure) {
      sourceFailures.push(outcome.failure)
      if (outcome.retryable) anyRetryable = true
    }
  }

  const totalSources = sources.length
  if (totalSources > 0 && sourceFailures.length === totalSources) {
    throwDiscoveryFailure(
      failure("all_sources_failed", {
        mastraRunId: options.runId,
        retryable: anyRetryable,
        details: sourceFailures.map((entry) => entry.code).join(","),
      }),
    )
  }

  return { items, sourceFailures }
}

/**
 * Parse raw items into videos, drop unparseable ones, dedupe by videoId, then
 * keep videos by source:
 *  - Trusted (curated channel/playlist): keep everything EXCEPT obvious
 *    commentary/reaction/news junk. No AI/Christian keyword requirement, so
 *    non-English and "Bible animation" content from your own list is kept.
 *  - Keyword search: full filter — must signal BOTH AI and Christian and not
 *    read as commentary.
 * Trusted items are ordered first by the collector, so they win dedup ties.
 * Capped at `maxResults`.
 */
export function selectQualifyingVideos(
  items: readonly TaggedRawItem[],
  input: YouTubeDiscoveryWorkflowInput,
): { videos: YouTubeVideo[]; totals: YouTubeDiscoveryTotals } {
  const parsed: Array<{ video: YouTubeVideo; trusted: boolean }> = []
  for (const item of items) {
    const video = parseYouTubeVideo(item.raw)
    if (video) parsed.push({ video, trusted: item.trusted })
  }

  const byId = new Map<string, { video: YouTubeVideo; trusted: boolean }>()
  for (const entry of parsed) {
    if (!byId.has(entry.video.videoId)) byId.set(entry.video.videoId, entry)
  }
  const deduped = [...byId.values()]

  const qualified: YouTubeVideo[] = []
  let excludedCommentary = 0
  for (const { video, trusted } of deduped) {
    const signals = classifyContent({
      caption: `${video.title} ${video.description}`,
      hashtags: video.hashtags,
    })
    const keep = trusted ? !signals.isCommentary : qualifies(signals)
    if (!keep) {
      // Count drops attributable to the commentary filter: any trusted item
      // dropped as commentary, plus search items that were AI+Christian but read
      // as commentary (the exclusion filter's job).
      if (
        signals.isCommentary &&
        (trusted || (signals.isAiGenerated && signals.isChristian))
      ) {
        excludedCommentary += 1
      }
      continue
    }
    if (qualified.length < input.maxResults) {
      qualified.push({
        ...video,
        matchedAi: signals.matchedAi,
        matchedChristian: signals.matchedChristian,
      })
    }
  }

  return {
    videos: qualified,
    totals: {
      candidates: items.length,
      videos: parsed.length,
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
  channels: string[]
  playlists: string[]
  queries: string[]
  totals: YouTubeDiscoveryTotals
  sourceFailures: DiscoverySourceFailure[]
  videos: YouTubeVideo[]
}): YouTubeDiscoveryReport {
  return {
    schemaVersion: "1",
    kind: "youtube-ai-christian-discovery",
    reportId: args.runId,
    mastraRunId: args.runId,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    channels: args.channels,
    playlists: args.playlists,
    queries: args.queries,
    totals: args.totals,
    sourceFailures: args.sourceFailures,
    videos: args.videos,
  }
}

/**
 * Core orchestration — fully injectable, used by both the route handler path
 * and unit tests. Returns a discriminated-union result rather than throwing.
 */
export async function runYouTubeDiscovery(
  rawInput: unknown,
  options: YouTubeDiscoveryOptions = {},
): Promise<YouTubeDiscoveryWorkflowResult> {
  const mastraRunId = options.runId ?? randomUUID()
  const now = options.now ?? (() => new Date())
  const youtubeConfig = options.youtubeConfig ?? getYouTubeConfig()
  const client = options.client ?? defaultYouTubeClient
  const artifactStore =
    options.artifactStore ?? createYouTubeDiscoveryArtifactStore()

  const parsedInput = YouTubeDiscoveryWorkflowInputSchema.safeParse(rawInput)
  if (!parsedInput.success) {
    return failure("invalid_input", { mastraRunId, retryable: false })
  }
  const savedSources = await withSavedYouTubeSources(parsedInput.data, {
    config: options.sourcesConfig,
    fetchImpl: options.fetchSources,
  })
  const input = savedSources.input
  if (
    savedSources.sourceLoadStatus === "failed" &&
    input.channels.length === 0 &&
    input.playlists.length === 0 &&
    input.queries.length === 0
  ) {
    return failure("sources_unavailable", {
      mastraRunId,
      retryable: true,
      details: "saved YouTube sources could not be loaded",
    })
  }

  const startedAt = now().toISOString()
  try {
    const { items, sourceFailures } = await collectYouTubeCandidates(input, {
      runId: mastraRunId,
      youtubeConfig,
      client,
    })
    const { videos, totals } = selectQualifyingVideos(items, input)
    const finishedAt = now().toISOString()

    let artifactPath: string | undefined
    if (input.persistArtifact) {
      const report = buildReport({
        runId: mastraRunId,
        startedAt,
        finishedAt,
        channels: input.channels,
        playlists: input.playlists,
        queries: input.queries,
        totals,
        sourceFailures,
        videos,
      })
      const written = await artifactStore.writeReport(report)
      artifactPath = written.path
    }

    const reviewQueue = await submitToReviewQueue(videos, options)

    return {
      ok: true,
      mastraRunId,
      totals,
      videos,
      sourceFailures,
      reviewQueue,
      ...(artifactPath ? { artifactPath } : {}),
    } satisfies YouTubeDiscoveryWorkflowSuccess
  } catch (error) {
    return (
      discoveryFailureFromUnknown(error) ??
      failure("all_sources_failed", {
        mastraRunId,
        retryable: true,
        details: error instanceof Error ? error.message : String(error),
      })
    )
  }
}

// --- Mastra workflow (Studio-facing) ---------------------------------------

const CollectStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      input: YouTubeDiscoveryWorkflowInputSchema,
      startedAt: z.string(),
      items: z.array(TaggedRawItemSchema),
      sourceFailures: z.array(DiscoverySourceFailureSchema),
    })
    .strict(),
  WorkflowFailureSchema,
])

const FilterStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      input: YouTubeDiscoveryWorkflowInputSchema,
      startedAt: z.string(),
      videos: z.array(YouTubeVideoSchema),
      totals: YouTubeDiscoveryTotalsSchema,
      sourceFailures: z.array(DiscoverySourceFailureSchema),
    })
    .strict(),
  WorkflowFailureSchema,
])

const collectStep = createStep({
  id: "collect-youtube-candidates",
  description:
    "Pull videos from trusted channels and keyword searches via the YouTube API.",
  inputSchema: YouTubeDiscoveryWorkflowInputSchema,
  outputSchema: CollectStepOutputSchema,
  execute: async ({ inputData, runId }) => {
    const startedAt = new Date().toISOString()
    try {
      const savedSources = await withSavedYouTubeSources(inputData, {
        config: getDiscoverySourcesConfig(),
      })
      const input = savedSources.input
      if (
        savedSources.sourceLoadStatus === "failed" &&
        input.channels.length === 0 &&
        input.playlists.length === 0 &&
        input.queries.length === 0
      ) {
        throwDiscoveryFailure(
          failure("sources_unavailable", {
            mastraRunId: runId,
            retryable: true,
            details: "saved YouTube sources could not be loaded",
          }),
        )
      }
      const { items, sourceFailures } = await collectYouTubeCandidates(input, {
        runId,
        youtubeConfig: getYouTubeConfig(),
        client: defaultYouTubeClient,
      })
      return {
        ok: true as const,
        input,
        startedAt,
        items: items.map((it) => ({
          raw: it.raw as Record<string, unknown>,
          trusted: it.trusted,
        })),
        sourceFailures,
      }
    } catch (error) {
      const parsed = discoveryFailureFromUnknown(error)
      if (parsed) throwDiscoveryFailure(parsed)
      throw error
    }
  },
})

const filterStep = createStep({
  id: "parse-and-filter-videos",
  description:
    "Parse YouTube items, dedupe by videoId, and keep qualifying videos.",
  inputSchema: CollectStepOutputSchema,
  outputSchema: FilterStepOutputSchema,
  execute: async ({ inputData }) => {
    if (!inputData.ok) throwDiscoveryFailure(inputData)
    const input = inputData.input
    const { videos, totals } = selectQualifyingVideos(
      inputData.items as TaggedRawItem[],
      input,
    )
    return {
      ok: true as const,
      input,
      startedAt: inputData.startedAt,
      videos,
      totals,
      sourceFailures: inputData.sourceFailures,
    }
  },
})

const reportStep = createStep({
  id: "report-and-persist",
  description: "Build the discovery report and persist it when requested.",
  inputSchema: FilterStepOutputSchema,
  outputSchema: YouTubeDiscoveryWorkflowOutputSchema,
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
        channels: input.channels,
        playlists: input.playlists,
        queries: input.queries,
        totals: inputData.totals,
        sourceFailures: inputData.sourceFailures,
        videos: inputData.videos,
      })
      const written =
        await createYouTubeDiscoveryArtifactStore().writeReport(report)
      artifactPath = written.path
    }

    const reviewQueue = await submitToReviewQueue(inputData.videos, {})

    return {
      ok: true as const,
      mastraRunId: runId,
      totals: inputData.totals,
      videos: inputData.videos,
      sourceFailures: inputData.sourceFailures,
      reviewQueue,
      ...(artifactPath ? { artifactPath } : {}),
    }
  },
})

export const youtubeAiChristianDiscoveryWorkflow = createWorkflow({
  id: "youtube-ai-christian-discovery",
  description:
    "Discover AI-generated Christian videos on YouTube via trusted channels and keyword search.",
  inputSchema: YouTubeDiscoveryWorkflowInputSchema,
  outputSchema: YouTubeDiscoveryWorkflowOutputSchema,
  schedule: {
    cron: "0 1 * * *",
    timezone: "UTC",
  },
})
  .then(collectStep)
  .then(filterStep)
  .then(reportStep)
  .commit()

export async function launchYouTubeDiscoveryWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<YouTubeDiscoveryWorkflowResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = YouTubeDiscoveryWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", { mastraRunId: runId, retryable: false })
  }

  const run = await youtubeAiChristianDiscoveryWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      discoveryFailureFromUnknown(error) ??
      failure("all_sources_failed", { mastraRunId: runId, retryable: true })
    )
  }
  if (result.status === "success") return result.result
  return (
    discoveryFailureFromRunResult(result) ??
    failure("all_sources_failed", { mastraRunId: runId, retryable: true })
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
  ) => Promise<YouTubeDiscoveryWorkflowResult>
}

export type YouTubeDiscoveryRouteOutcome = {
  status: number
  body: { result?: YouTubeDiscoveryWorkflowResult; error?: string }
}

function routeStatusForResult(result: YouTubeDiscoveryWorkflowResult): number {
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

export async function handleYouTubeDiscoveryRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchYouTubeDiscoveryWorkflow,
}: RouteHandlerInput): Promise<YouTubeDiscoveryRouteOutcome> {
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
  toCandidate,
}
