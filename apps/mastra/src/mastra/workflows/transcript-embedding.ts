import { createHash, randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import {
  callAdminTranscriptIngest,
  type AdminTranscriptEmbeddingIngestPayload,
  type AdminTranscriptEmbeddingIngestResult,
  type AdminTranscriptIngestClientResult,
  type TranscriptEmbeddingGenerationMode,
} from "../../services/admin-transcript-ingest-client"
import {
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
  EmbeddingProviderError,
  requestModelForEndpoint,
  requestEmbeddingVectors,
  validateEmbeddingProviderResult,
  type EmbeddingProviderResult,
} from "../../services/embedding-provider"
import { env, getTranscriptEmbeddingProviderConfig } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"

const DEFAULT_MAX_CHUNK_TOKENS = 500
const DEFAULT_OVERLAP_TOKENS = 100
const DEFAULT_MAX_BATCH_CHUNKS = 8
const DEFAULT_MAX_BATCH_TOKENS = 20_000
const CHUNKING_VERSION = "enriched-transcript-v2"
const DEFAULT_PROVIDER_BATCH_MAX_ATTEMPTS = 3
const DEFAULT_PROVIDER_BATCH_RETRY_DELAY_MS = 1_000

type CanonicalFeltNeed =
  | "Acceptance"
  | "Anxiety"
  | "Depression"
  | "Fear/Power"
  | "Forgiveness"
  | "Guilt/Righteousness"
  | "Honor/Shame"
  | "Hope"
  | "Loneliness"
  | "Love"
  | "Security"
  | "Significance"

type CanonicalDemographic =
  | "Children"
  | "Youth"
  | "Young Adults"
  | "Parents"
  | "Families"
  | "Women"
  | "Men"
  | "Religious Leaders"
  | "Disciples"
  | "Seekers"
  | "Outsiders"
  | "People in Crisis"

const GenerationModeSchema = z
  .enum(["idempotent", "repair", "force", "model-upgrade"])
  .default("idempotent")

const AdminTargetSchema = z
  .object({
    videoId: z.string().min(1),
    videoEditionId: z.string().min(1),
    coreId: z.string().min(1).optional(),
  })
  .strict()

const ExternalTargetSchema = z
  .object({
    assetId: z.string().min(1).optional(),
    muxAssetId: z.string().min(1).optional(),
    adminVideoId: z.string().min(1).optional(),
  })
  .strict()

const TargetSchema = z
  .object({
    admin: AdminTargetSchema.optional(),
    external: ExternalTargetSchema.optional(),
  })
  .strict()
  .superRefine((target, ctx) => {
    const hasAdmin = target.admin != null
    const hasExternal = target.external != null
    if (hasAdmin === hasExternal) {
      ctx.addIssue({
        code: "custom",
        message: "exactly one target.admin or target.external is required",
      })
    }
    if (target.external && !target.external.muxAssetId) {
      ctx.addIssue({
        code: "custom",
        path: ["external", "muxAssetId"],
        message: "target.external.muxAssetId is required",
      })
    }
  })

const TranscriptSegmentSchema = z
  .object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    text: z.string(),
  })
  .strict()

const ChunkingOptionsSchema = z
  .object({
    maxChunkTokens: z.number().int().positive().optional(),
    overlapTokens: z.number().int().nonnegative().optional(),
    maxBatchChunks: z.number().int().positive().optional(),
    maxBatchTokens: z.number().int().positive().optional(),
    version: z.string().min(1).optional(),
  })
  .strict()

const ModelOptionsSchema = z
  .object({
    name: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
  })
  .strict()

export const TranscriptEmbeddingWorkflowInputSchema = z
  .object({
    target: TargetSchema,
    language: z.string().min(1),
    transcript: z
      .object({
        text: z.string().optional(),
        segments: z.array(TranscriptSegmentSchema).optional(),
        artifactKey: z.string().min(1).optional(),
        kind: z.enum(["subtitle", "manager-transcript"]).optional(),
        languageId: z.string().min(1).optional(),
        languageSlug: z.string().min(1).optional(),
        subtitleId: z.string().min(1).optional(),
        format: z.enum(["vtt", "srt"]).optional(),
        url: z.string().min(1).optional(),
        provider: z.string().min(1).optional(),
        generatedAt: z.string().min(1).optional(),
      })
      .strict(),
    mode: GenerationModeSchema,
    chunking: ChunkingOptionsSchema.optional(),
    model: ModelOptionsSchema.optional(),
  })
  .strict()

const PlannedRunSummarySchema = z
  .object({
    target: TargetSchema,
    language: z.string().min(1),
    mode: GenerationModeSchema,
    source: z
      .object({
        textLength: z.number().int().nonnegative(),
        segmentCount: z.number().int().nonnegative(),
        artifactKey: z.string().min(1).optional(),
        kind: z.enum(["subtitle", "manager-transcript"]).optional(),
        languageId: z.string().min(1).optional(),
        languageSlug: z.string().min(1).optional(),
        subtitleId: z.string().min(1).optional(),
        format: z.enum(["vtt", "srt"]).optional(),
        provider: z.string().min(1).optional(),
        generatedAt: z.string().min(1).optional(),
        contentHash: z.string().min(1),
      })
      .strict(),
    model: z
      .object({
        name: z.string().min(1),
        provider: z.string().min(1),
      })
      .strict(),
    chunking: z
      .object({
        type: z.enum(["segment-aware", "plain-text"]),
        maxChunkTokens: z.number().int().positive(),
        overlapTokens: z.number().int().nonnegative(),
        maxBatchChunks: z.number().int().positive(),
        maxBatchTokens: z.number().int().positive(),
        version: z.string().min(1),
        totalChunks: z.number().int().positive(),
        totalTokens: z.number().int().nonnegative(),
      })
      .strict(),
    generation: z
      .object({
        generatedAt: z.string().min(1),
        mastraRunId: z.string().min(1),
      })
      .strict(),
  })
  .strict()

const WorkflowSuccessSchema = z
  .object({
    ok: z.literal(true),
    status: z.enum([
      "created",
      "unchanged",
      "repaired",
      "forced",
      "model_upgraded",
    ]),
    target: z
      .object({
        videoId: z.string(),
        videoEditionId: z.string(),
        coreId: z.string(),
        language: z.string(),
      })
      .strict(),
    chunks: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    model: z.string(),
    provider: z.string(),
    dimensions: z.number().int().positive(),
    nativeDimensions: z.number().int().positive().optional(),
    transformVersion: z.string().optional(),
    mastraRunId: z.string(),
    sourceContentHash: z.string(),
    chunking: z
      .object({
        type: z.enum(["segment-aware", "plain-text"]),
        maxChunkTokens: z.number().int().positive(),
        overlapTokens: z.number().int().nonnegative(),
        version: z.string(),
      })
      .strict(),
  })
  .strict()

const WorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum([
      "invalid_input",
      "provider_config_missing",
      "provider_auth_failed",
      "provider_failed",
      "provider_dimension_mismatch",
      "admin_config_missing",
      "admin_auth_failed",
      "admin_ingest_rejected",
      "admin_ingest_failed",
    ]),
    retryable: z.boolean(),
    mastraRunId: z.string(),
    adminStatus: z.string().optional(),
    adminReason: z.string().optional(),
  })
  .strict()

export const TranscriptEmbeddingWorkflowOutputSchema = z.discriminatedUnion(
  "ok",
  [WorkflowSuccessSchema, WorkflowFailureSchema],
)

export type TranscriptEmbeddingWorkflowInput = z.infer<
  typeof TranscriptEmbeddingWorkflowInputSchema
>
type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>
type PlannedChunk = {
  chunkIndex: number
  chunkId: string
  text: string
  rawSourceText?: string
  embeddingInputText?: string
  feltNeeds?: CanonicalFeltNeed[]
  bibleVerses?: string[]
  contentSummary?: string
  tone?: string
  demographics?: CanonicalDemographic[]
  spiritualContext?: string[]
  extractionMetadata?: Record<string, unknown>
  tokenCount: number
  startSeconds?: number
  endSeconds?: number
}
type PlannedRun = {
  target: TranscriptEmbeddingWorkflowInput["target"]
  language: string
  mode: z.infer<typeof GenerationModeSchema>
  source: {
    text: string
    segments?: TranscriptSegment[]
    artifactKey?: string
    kind?: "subtitle" | "manager-transcript"
    languageId?: string
    languageSlug?: string
    subtitleId?: string
    format?: "vtt" | "srt"
    url?: string
    provider?: string
    generatedAt?: string
    contentHash: string
  }
  model: {
    name: string
    provider: string
  }
  chunking: {
    type: "segment-aware" | "plain-text"
    maxChunkTokens: number
    overlapTokens: number
    maxBatchChunks: number
    maxBatchTokens: number
    version: string
  }
  generation: {
    generatedAt: string
    mastraRunId: string
  }
  chunks: PlannedChunk[]
}
type EmbeddedChunk = PlannedChunk & { embedding: number[] }
type EmbeddedRun = Omit<PlannedRun, "chunks"> & {
  dimensions: number
  nativeDimensions?: number
  transformVersion?: string
  providerTokenCount: number
  chunks: EmbeddedChunk[]
}
export type TranscriptEmbeddingWorkflowResult = z.infer<
  typeof TranscriptEmbeddingWorkflowOutputSchema
>
type TranscriptEmbeddingWorkflowFailure = z.infer<typeof WorkflowFailureSchema>
type TranscriptEmbeddingWorkflowFailureReason =
  TranscriptEmbeddingWorkflowFailure["reason"]
const WORKFLOW_FAILURE_ERROR_PREFIX = "TRANSCRIPT_EMBEDDING_WORKFLOW_FAILED:"

const PlannedRunStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      summary: PlannedRunSummarySchema,
    })
    .strict(),
  WorkflowFailureSchema,
])

const EmbeddedRunStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      summary: PlannedRunSummarySchema,
      embedding: z
        .object({
          dimensions: z.number().int().positive(),
          providerTokenCount: z.number().int().nonnegative(),
          chunkCount: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  WorkflowFailureSchema,
])

export type TranscriptEmbeddingWorkflowOptions = {
  runId?: string
  generatedAt?: string
  apiKey?: string
  embeddingsBaseUrl?: string
  ingestUrl?: string
  adminBearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  embeddingRequester?: (
    input: string[],
    options: {
      expectedDimensions: number
      context: string
      itemLabel: string
    },
  ) => Promise<EmbeddingProviderResult>
  providerRetryMaxAttempts?: number
  providerRetryDelayMs?: number
  adminIngestClient?: (
    payload: AdminTranscriptEmbeddingIngestPayload,
  ) => Promise<AdminTranscriptIngestClientResult>
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<TranscriptEmbeddingWorkflowResult>
}

const embeddedRunByMastraRunId = new Map<string, EmbeddedRun>()

export type TranscriptEmbeddingRouteOutcome = {
  status: number
  body: { result?: TranscriptEmbeddingWorkflowResult; error?: string }
}

function routeRequestEnvelope(body: unknown): {
  runId: string
  input: unknown
} {
  if (
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "runId" in body &&
    "input" in body
  ) {
    const record = body as { runId?: unknown; input?: unknown }
    const runId =
      typeof record.runId === "string" && record.runId.trim()
        ? record.runId.trim()
        : randomUUID()
    return { runId, input: record.input }
  }

  return { runId: randomUUID(), input: body }
}

function normalizeTranscriptText(
  transcript: TranscriptEmbeddingWorkflowInput["transcript"],
): string {
  const text = transcript.text?.trim() ?? ""
  if (text) return text

  return (transcript.segments ?? [])
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim()
}

function normalizeSegments(
  segments: TranscriptSegment[] | undefined,
): TranscriptSegment[] | undefined {
  const normalized = (segments ?? [])
    .map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text.trim(),
    }))
    .filter((segment) => segment.text.length > 0)

  return normalized.length > 0 ? normalized : undefined
}

function estimateTokenCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return Math.ceil(trimmed.split(/\s+/).length / 0.75)
}

function formatTimeRange(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "unknown"
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
}

function summarizeChunkText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= 180) return normalized
  return `${normalized.slice(0, 177).trim()}...`
}

function extractBibleVerses(text: string): string[] {
  const matches = text.match(
    /\b(?:[1-3]\s*)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+\d{1,3}:\d{1,3}(?:-\d{1,3})?\b/g,
  )
  return Array.from(new Set(matches ?? []))
}

function inferFeltNeeds(text: string): CanonicalFeltNeed[] {
  const lower = text.toLowerCase()
  const needs: CanonicalFeltNeed[] = []
  const add = (need: CanonicalFeltNeed) => {
    if (!needs.includes(need)) needs.push(need)
  }

  if (/\b(accept|accepted|belong|welcome|included)\b/.test(lower)) {
    add("Acceptance")
  }
  if (/\b(anxious|anxiety|worry|worried)\b/.test(lower)) add("Anxiety")
  if (/\b(depress|sad|sorrow|despair)\b/.test(lower)) add("Depression")
  if (/\b(fear|afraid|power|deliver|oppress)\b/.test(lower)) add("Fear/Power")
  if (/\b(forgive|forgiven|forgiveness|mercy)\b/.test(lower)) {
    add("Forgiveness")
  }
  if (/\b(guilt|guilty|righteous|righteousness|sin)\b/.test(lower)) {
    add("Guilt/Righteousness")
  }
  if (/\b(shame|honor|disgrace)\b/.test(lower)) add("Honor/Shame")
  if (/\b(hope|promise|future|restore)\b/.test(lower)) add("Hope")
  if (/\b(alone|lonely|forsaken)\b/.test(lower)) add("Loneliness")
  if (/\b(love|beloved|compassion)\b/.test(lower)) add("Love")
  if (/\b(safe|secure|security|protect|shelter)\b/.test(lower)) {
    add("Security")
  }
  if (/\b(worth|value|significant|purpose|called)\b/.test(lower)) {
    add("Significance")
  }

  return needs
}

function inferDemographics(text: string): CanonicalDemographic[] {
  const lower = text.toLowerCase()
  const demographics: CanonicalDemographic[] = []
  const add = (demographic: CanonicalDemographic) => {
    if (!demographics.includes(demographic)) demographics.push(demographic)
  }

  if (/\b(child|children|kid|kids|little ones)\b/.test(lower)) add("Children")
  if (/\b(youth|teen|teenager|teenagers|young people)\b/.test(lower)) {
    add("Youth")
  }
  if (/\b(young man|young woman|young adult|young adults)\b/.test(lower)) {
    add("Young Adults")
  }
  if (/\b(parent|parents|mother|father|mom|dad)\b/.test(lower)) add("Parents")
  if (/\b(family|families|household|households)\b/.test(lower)) {
    add("Families")
  }
  if (/\b(woman|women|wife|wives|widow|widows)\b/.test(lower)) add("Women")
  if (/\b(man|men|husband|husbands)\b/.test(lower)) add("Men")
  if (
    /\b(pharisee|pharisees|priest|priests|rabbi|rabbis|teacher of the law|teachers of the law|religious leader|religious leaders)\b/.test(
      lower,
    )
  ) {
    add("Religious Leaders")
  }
  if (/\b(disciple|disciples|follower|followers)\b/.test(lower)) {
    add("Disciples")
  }
  if (
    /\b(seek|seeks|seeking|searched|searching|question|questions|asked him|ask him)\b/.test(
      lower,
    )
  ) {
    add("Seekers")
  }
  if (
    /\b(samaritan|samaritans|gentile|gentiles|tax collector|tax collectors|foreigner|foreigners|outcast|outcasts|sinner|sinners)\b/.test(
      lower,
    )
  ) {
    add("Outsiders")
  }
  if (
    /\b(sick|ill|blind|lame|leper|lepers|poor|hungry|prisoner|prisoners|mourning|grieving|possessed|oppressed)\b/.test(
      lower,
    )
  ) {
    add("People in Crisis")
  }

  return demographics
}

function enrichChunk(chunk: PlannedChunk): PlannedChunk {
  const rawSourceText = chunk.rawSourceText ?? chunk.text
  const feltNeeds = inferFeltNeeds(rawSourceText)
  const bibleVerses = extractBibleVerses(rawSourceText)
  const contentSummary = summarizeChunkText(rawSourceText)
  const timeRange = `${formatTimeRange(chunk.startSeconds)}-${formatTimeRange(chunk.endSeconds)}`
  const tone = "reflective"
  const demographics = inferDemographics(rawSourceText)
  const spiritualContext = bibleVerses.length > 0 ? ["Bible reference"] : []
  const embeddingInputText = [
    `Time range: ${timeRange}`,
    `Felt needs: ${feltNeeds.length > 0 ? feltNeeds.join(", ") : "None"}`,
    `Bible verses: ${bibleVerses.length > 0 ? bibleVerses.join(", ") : "None"}`,
    `Summary: ${contentSummary}`,
    `Tone: ${tone}`,
    `Demographics: ${demographics.length > 0 ? demographics.join(", ") : "None"}`,
    `Spiritual context: ${
      spiritualContext.length > 0 ? spiritualContext.join(", ") : "None"
    }`,
    `Transcript: ${rawSourceText}`,
  ].join("\n")

  return {
    ...chunk,
    text: rawSourceText,
    rawSourceText,
    embeddingInputText,
    feltNeeds,
    bibleVerses,
    contentSummary,
    tone,
    demographics,
    spiritualContext,
    extractionMetadata: {
      strategy: "deterministic-transcript-grounded-v1",
      source: "transcript",
      demographicsStrategy: "explicit-cue-taxonomy-v1",
    },
    tokenCount: estimateTokenCount(embeddingInputText),
  }
}

function chunkText(
  text: string,
  options: {
    maxChunkTokens: number
    overlapTokens: number
    startSeconds?: number
    endSeconds?: number
  },
): Array<Omit<PlannedChunk, "chunkId" | "chunkIndex">> {
  const trimmed = text.trim()
  if (!trimmed) return []

  const words = trimmed.split(/\s+/)
  const wordsPerChunk = Math.max(1, Math.floor(options.maxChunkTokens * 0.75))
  const overlapWords = Math.max(
    0,
    Math.min(wordsPerChunk - 1, Math.floor(options.overlapTokens * 0.75)),
  )
  const step = Math.max(1, wordsPerChunk - overlapWords)
  const chunks: Array<Omit<PlannedChunk, "chunkId" | "chunkIndex">> = []

  for (let start = 0; start < words.length; start += step) {
    const chunkWords = words.slice(start, start + wordsPerChunk)
    if (chunkWords.length === 0) break

    const chunkValue = chunkWords.join(" ").trim()
    chunks.push({
      text: chunkValue,
      tokenCount: estimateTokenCount(chunkValue),
      startSeconds: options.startSeconds,
      endSeconds: options.endSeconds,
    })

    if (start + wordsPerChunk >= words.length) break
  }

  return chunks
}

function assignChunkIds(
  chunks: Array<Omit<PlannedChunk, "chunkId" | "chunkIndex">>,
): PlannedChunk[] {
  return chunks.map((chunk, index) => ({
    chunkIndex: index,
    chunkId: `chunk-${index}`,
    ...chunk,
  }))
}

function planPlainTextChunks(
  text: string,
  options: { maxChunkTokens: number; overlapTokens: number },
): PlannedChunk[] {
  return assignChunkIds(
    chunkText(text, {
      maxChunkTokens: options.maxChunkTokens,
      overlapTokens: options.overlapTokens,
    }),
  )
}

function buildSegmentChunk(
  segments: TranscriptSegment[],
): Omit<PlannedChunk, "chunkId" | "chunkIndex"> {
  const text = segments
    .map((segment) => segment.text.trim())
    .join(" ")
    .trim()
  return {
    text,
    tokenCount: estimateTokenCount(text),
    startSeconds: segments[0]!.start,
    endSeconds: segments[segments.length - 1]!.end,
  }
}

function buildOverlapSegments(
  segments: TranscriptSegment[],
  overlapTokens: number,
  maxChunkTokens: number,
): TranscriptSegment[] {
  if (overlapTokens <= 0) return []

  const overlap: TranscriptSegment[] = []
  let tokenCount = 0
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!
    overlap.unshift(segment)
    tokenCount += estimateTokenCount(segment.text)
    if (tokenCount >= overlapTokens) break
  }

  while (tokenCount > maxChunkTokens && overlap.length > 0) {
    tokenCount -= estimateTokenCount(overlap[0]!.text)
    overlap.shift()
  }

  return overlap
}

function planSegmentChunks(
  segments: TranscriptSegment[],
  options: { maxChunkTokens: number; overlapTokens: number },
): PlannedChunk[] {
  const usableSegments = segments.filter((segment) => segment.text.trim())
  if (usableSegments.length === 0) return []

  const chunks: Array<Omit<PlannedChunk, "chunkId" | "chunkIndex">> = []
  let currentSegments: TranscriptSegment[] = []
  let currentTokens = 0

  for (const segment of usableSegments) {
    const segmentTokens = estimateTokenCount(segment.text)
    if (segmentTokens > options.maxChunkTokens) {
      if (currentSegments.length > 0) {
        chunks.push(buildSegmentChunk(currentSegments))
        currentSegments = []
        currentTokens = 0
      }

      chunks.push(
        ...chunkText(segment.text, {
          maxChunkTokens: options.maxChunkTokens,
          overlapTokens: options.overlapTokens,
          startSeconds: segment.start,
          endSeconds: segment.end,
        }),
      )
      continue
    }

    if (
      currentSegments.length > 0 &&
      currentTokens + segmentTokens > options.maxChunkTokens
    ) {
      chunks.push(buildSegmentChunk(currentSegments))
      currentSegments = buildOverlapSegments(
        currentSegments,
        options.overlapTokens,
        options.maxChunkTokens,
      )
      currentTokens = currentSegments.reduce(
        (sum, overlapSegment) => sum + estimateTokenCount(overlapSegment.text),
        0,
      )

      while (
        currentSegments.length > 0 &&
        currentTokens + segmentTokens > options.maxChunkTokens
      ) {
        currentTokens -= estimateTokenCount(currentSegments[0]!.text)
        currentSegments = currentSegments.slice(1)
      }
    }

    currentSegments.push(segment)
    currentTokens += segmentTokens
  }

  if (currentSegments.length > 0) {
    chunks.push(buildSegmentChunk(currentSegments))
  }

  return assignChunkIds(chunks)
}

function createBatches(
  chunks: PlannedChunk[],
  options: { maxBatchChunks: number; maxBatchTokens: number },
): PlannedChunk[][] {
  const batches: PlannedChunk[][] = []
  let currentBatch: PlannedChunk[] = []
  let currentTokens = 0

  for (const chunk of chunks) {
    const exceedsChunkCount = currentBatch.length >= options.maxBatchChunks
    const exceedsTokenBudget =
      currentBatch.length > 0 &&
      currentTokens + chunk.tokenCount > options.maxBatchTokens

    if (exceedsChunkCount || exceedsTokenBudget) {
      batches.push(currentBatch)
      currentBatch = []
      currentTokens = 0
    }

    currentBatch.push(chunk)
    currentTokens += chunk.tokenCount
  }

  if (currentBatch.length > 0) batches.push(currentBatch)
  return batches
}

function isRecoverableGatewayProviderError(
  error: unknown,
): error is EmbeddingProviderError {
  return (
    error instanceof EmbeddingProviderError &&
    (error.code === "upstream_failed" || error.code === "invalid_response")
  )
}

function shouldSplitProviderBatch(error: unknown, batchSize: number): boolean {
  return (
    batchSize > 1 &&
    isRecoverableGatewayProviderError(error) &&
    !error.retryable
  )
}

function shouldRetryProviderBatch(
  error: unknown,
  options: { batchSize: number; attempt: number; maxAttempts: number },
): boolean {
  if (options.attempt >= options.maxAttempts) return false
  if (!isRecoverableGatewayProviderError(error)) return false

  return error.retryable || options.batchSize === 1
}

function retryDelayMs(options: {
  baseDelayMs: number
  attempt: number
}): number {
  if (options.baseDelayMs <= 0) return 0
  return options.baseDelayMs * 2 ** Math.max(0, options.attempt - 1)
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function combineEmbeddingProviderResults(
  left: EmbeddingProviderResult,
  right: EmbeddingProviderResult,
  options: {
    context: string
    itemLabel: string
    expectedDimensions: number
    expectedCount: number
  },
): EmbeddingProviderResult {
  const mismatch =
    left.dimensions !== right.dimensions ||
    left.model !== right.model ||
    left.provider !== right.provider ||
    left.requestModel !== right.requestModel ||
    left.nativeDimensions !== right.nativeDimensions ||
    left.transformVersion !== right.transformVersion

  if (mismatch) {
    throw new EmbeddingProviderError(
      "dimension_mismatch",
      `${options.context} split embedding responses were inconsistent`,
    )
  }

  return validateEmbeddingProviderResult(
    {
      embeddings: [...left.embeddings, ...right.embeddings],
      dimensions: left.dimensions,
      nativeDimensions: left.nativeDimensions ?? right.nativeDimensions,
      transformVersion: left.transformVersion ?? right.transformVersion,
      tokenCount: left.tokenCount + right.tokenCount,
      model: left.model,
      provider: left.provider,
      requestModel: left.requestModel,
    },
    options.expectedCount,
    {
      expectedDimensions: options.expectedDimensions,
      context: options.context,
      itemLabel: options.itemLabel,
    },
  )
}

async function requestEmbeddingBatchWithFallback(
  batch: PlannedChunk[],
  options: TranscriptEmbeddingWorkflowOptions & {
    planned: PlannedRun
    providerConfig: ReturnType<typeof getTranscriptEmbeddingProviderConfig>
    context: string
    splitDepth?: number
    splitPath?: string
  },
): Promise<EmbeddingProviderResult> {
  const batchInput = batch.map(
    (chunk) => chunk.embeddingInputText ?? chunk.text,
  )
  const maxAttempts =
    options.providerRetryMaxAttempts ?? DEFAULT_PROVIDER_BATCH_MAX_ATTEMPTS
  const retryBaseDelayMs =
    options.providerRetryDelayMs ?? DEFAULT_PROVIDER_BATCH_RETRY_DELAY_MS

  for (let attempt = 1; ; attempt += 1) {
    let rawResult: EmbeddingProviderResult
    try {
      rawResult = options.embeddingRequester
        ? await options.embeddingRequester(batchInput, {
            expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
            context: options.context,
            itemLabel: "chunks",
          })
        : await requestEmbeddingVectors(batchInput, {
            apiKey: options.apiKey ?? options.providerConfig.apiKey,
            baseUrl:
              options.embeddingsBaseUrl ?? options.providerConfig.baseUrl,
            model: options.planned.model.name,
            provider: options.planned.model.provider,
            expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
            expectedNativeDimensions:
              options.providerConfig.expectedNativeDimensions,
            truncateToDimensions: options.providerConfig.truncateToDimensions,
            transformVersion: options.providerConfig.transformVersion,
            userAgent: options.providerConfig.userAgent,
            context: options.context,
            itemLabel: "chunks",
            timeoutMs: options.timeoutMs ?? options.providerConfig.timeoutMs,
            fetchImpl: options.fetchImpl,
          })
    } catch (error) {
      if (
        shouldRetryProviderBatch(error, {
          batchSize: batch.length,
          attempt,
          maxAttempts,
        })
      ) {
        const delayMs = retryDelayMs({
          baseDelayMs: retryBaseDelayMs,
          attempt,
        })
        console.warn(
          JSON.stringify({
            event: "transcript_embedding_batch_provider_retry",
            context: options.context,
            mastraRunId: options.planned.generation.mastraRunId,
            target: options.planned.target,
            language: options.planned.language,
            model: options.planned.model.name,
            provider: options.planned.model.provider,
            requestModel: requestModelForEndpoint(
              options.planned.model.name,
              options.embeddingsBaseUrl ?? options.providerConfig.baseUrl,
            ),
            errorCode:
              error instanceof EmbeddingProviderError ? error.code : "unknown",
            retryable:
              error instanceof EmbeddingProviderError ? error.retryable : null,
            attempt,
            maxAttempts,
            delayMs,
            chunkCount: batch.length,
            tokenCount: batch.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
          }),
        )
        await sleep(delayMs)
        continue
      }

      if (!shouldSplitProviderBatch(error, batch.length)) throw error

      const splitDepth = options.splitDepth ?? 0
      const splitPath = options.splitPath ?? "root"
      console.warn(
        JSON.stringify({
          event: "transcript_embedding_batch_split_retry",
          context: options.context,
          mastraRunId: options.planned.generation.mastraRunId,
          target: options.planned.target,
          language: options.planned.language,
          model: options.planned.model.name,
          provider: options.planned.model.provider,
          requestModel: requestModelForEndpoint(
            options.planned.model.name,
            options.embeddingsBaseUrl ?? options.providerConfig.baseUrl,
          ),
          errorCode:
            error instanceof EmbeddingProviderError ? error.code : "unknown",
          retryable:
            error instanceof EmbeddingProviderError ? error.retryable : null,
          splitDepth,
          splitPath,
          chunkCount: batch.length,
          tokenCount: batch.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
        }),
      )

      const splitIndex = Math.ceil(batch.length / 2)
      const left = await requestEmbeddingBatchWithFallback(
        batch.slice(0, splitIndex),
        {
          ...options,
          context: `${options.context} split 1/2`,
          splitDepth: splitDepth + 1,
          splitPath: `${splitPath}.1`,
        },
      )
      const right = await requestEmbeddingBatchWithFallback(
        batch.slice(splitIndex),
        {
          ...options,
          context: `${options.context} split 2/2`,
          splitDepth: splitDepth + 1,
          splitPath: `${splitPath}.2`,
        },
      )

      return combineEmbeddingProviderResults(left, right, {
        context: options.context,
        itemLabel: "chunks",
        expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
        expectedCount: batch.length,
      })
    }

    return validateEmbeddingProviderResult(rawResult, batch.length, {
      expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
      context: options.context,
      itemLabel: "chunks",
    })
  }
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`
}

function sourceContentHash({
  text,
  segments,
  source,
  chunks,
}: {
  text: string
  segments?: TranscriptSegment[]
  source?: {
    kind?: "subtitle" | "manager-transcript"
    artifactKey?: string
    languageId?: string
    languageSlug?: string
    subtitleId?: string
    format?: "vtt" | "srt"
    url?: string
    provider?: string
    generatedAt?: string
  }
  chunks: PlannedChunk[]
}): string {
  const hasV2SourceMetadata =
    source?.kind != null ||
    source?.languageId != null ||
    source?.languageSlug != null ||
    source?.subtitleId != null ||
    source?.format != null ||
    source?.url != null

  return sha256Json({
    text,
    segments: segments ?? null,
    ...(hasV2SourceMetadata
      ? {
          source: {
            kind: source?.kind ?? null,
            artifactKey: source?.artifactKey ?? null,
            languageId: source?.languageId ?? null,
            languageSlug: source?.languageSlug ?? null,
            subtitleId: source?.subtitleId ?? null,
            format: source?.format ?? null,
            url: source?.url ?? null,
            provider: source?.provider ?? null,
            generatedAt: source?.generatedAt ?? null,
          },
        }
      : {}),
    chunks: chunks.map((chunk) => {
      const base = {
        index: chunk.chunkIndex,
        text: chunk.text,
        startSeconds: chunk.startSeconds ?? null,
        endSeconds: chunk.endSeconds ?? null,
      }
      const hasEnrichedFields =
        chunk.rawSourceText != null ||
        chunk.embeddingInputText != null ||
        (chunk.feltNeeds?.length ?? 0) > 0 ||
        (chunk.bibleVerses?.length ?? 0) > 0 ||
        chunk.contentSummary != null ||
        chunk.tone != null ||
        (chunk.demographics?.length ?? 0) > 0 ||
        (chunk.spiritualContext?.length ?? 0) > 0 ||
        chunk.extractionMetadata != null

      return hasEnrichedFields
        ? {
            ...base,
            rawSourceText: chunk.rawSourceText ?? null,
            embeddingInputText: chunk.embeddingInputText ?? null,
            feltNeeds: chunk.feltNeeds ?? [],
            bibleVerses: chunk.bibleVerses ?? [],
            contentSummary: chunk.contentSummary ?? null,
            tone: chunk.tone ?? null,
            demographics: chunk.demographics ?? [],
            spiritualContext: chunk.spiritualContext ?? [],
            extractionMetadata: chunk.extractionMetadata ?? null,
          }
        : base
    }),
  })
}

function summarizePlannedRun(planned: PlannedRun) {
  return {
    target: planned.target,
    language: planned.language,
    mode: planned.mode,
    source: {
      textLength: planned.source.text.length,
      segmentCount: planned.source.segments?.length ?? 0,
      artifactKey: planned.source.artifactKey,
      provider: planned.source.provider,
      generatedAt: planned.source.generatedAt,
      contentHash: planned.source.contentHash,
    },
    model: planned.model,
    chunking: {
      type: planned.chunking.type,
      maxChunkTokens: planned.chunking.maxChunkTokens,
      overlapTokens: planned.chunking.overlapTokens,
      maxBatchChunks: planned.chunking.maxBatchChunks,
      maxBatchTokens: planned.chunking.maxBatchTokens,
      version: planned.chunking.version,
      totalChunks: planned.chunks.length,
      totalTokens: planned.chunks.reduce(
        (sum, chunk) => sum + chunk.tokenCount,
        0,
      ),
    },
    generation: planned.generation,
  }
}

function summarizeEmbeddedRun(embedded: EmbeddedRun) {
  return {
    summary: summarizePlannedRun(embedded),
    embedding: {
      dimensions: embedded.dimensions,
      providerTokenCount: embedded.providerTokenCount,
      chunkCount: embedded.chunks.length,
    },
  }
}

function failure(
  reason: TranscriptEmbeddingWorkflowFailureReason,
  options: {
    mastraRunId: string
    retryable: boolean
    adminStatus?: string
    adminReason?: string
  },
): TranscriptEmbeddingWorkflowFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    mastraRunId: options.mastraRunId,
    adminStatus: options.adminStatus,
    adminReason: options.adminReason,
  }
}

class TranscriptEmbeddingWorkflowFailureError extends Error {
  constructor(readonly result: TranscriptEmbeddingWorkflowFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "TranscriptEmbeddingWorkflowFailureError"
  }
}

function throwWorkflowFailure(
  result: TranscriptEmbeddingWorkflowFailure,
): never {
  throw new TranscriptEmbeddingWorkflowFailureError(result)
}

function workflowFailureFromUnknown(
  value: unknown,
): TranscriptEmbeddingWorkflowFailure | null {
  if (value instanceof TranscriptEmbeddingWorkflowFailureError) {
    return value.result
  }

  const message =
    value instanceof Error
      ? value.message
      : typeof value === "object" && value !== null && "message" in value
        ? String((value as { message?: unknown }).message ?? "")
        : typeof value === "string"
          ? value
          : ""

  const prefixIndex = message.indexOf(WORKFLOW_FAILURE_ERROR_PREFIX)
  if (prefixIndex < 0) return null

  const parsed = WorkflowFailureSchema.safeParse(
    JSON.parse(
      message.slice(prefixIndex + WORKFLOW_FAILURE_ERROR_PREFIX.length),
    ),
  )
  return parsed.success ? parsed.data : null
}

function workflowFailureFromRunResult(
  value: unknown,
): TranscriptEmbeddingWorkflowFailure | null {
  const direct = workflowFailureFromUnknown(value)
  if (direct) return direct

  if (value === null || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return (
    workflowFailureFromUnknown(record.error) ??
    workflowFailureFromUnknown(record.result) ??
    workflowFailureFromUnknown(record.snapshot)
  )
}

function failureFromEmbeddingError(
  error: unknown,
  mastraRunId: string,
): TranscriptEmbeddingWorkflowFailure {
  if (error instanceof EmbeddingProviderError) {
    if (error.code === "config_missing") {
      return failure("provider_config_missing", {
        mastraRunId,
        retryable: false,
      })
    }
    if (error.code === "auth_failed") {
      return failure("provider_auth_failed", {
        mastraRunId,
        retryable: false,
      })
    }
    if (error.code === "dimension_mismatch") {
      return failure("provider_dimension_mismatch", {
        mastraRunId,
        retryable: false,
      })
    }
    return failure("provider_failed", {
      mastraRunId,
      retryable: error.retryable,
    })
  }

  return failure("provider_failed", {
    mastraRunId,
    retryable: true,
  })
}

export function planTranscriptEmbeddingRun(
  rawInput: unknown,
  options: { mastraRunId: string; generatedAt?: string } = {
    mastraRunId: randomUUID(),
  },
): PlannedRun {
  const input = TranscriptEmbeddingWorkflowInputSchema.parse(rawInput)
  const providerConfig = getTranscriptEmbeddingProviderConfig()
  const sourceText = normalizeTranscriptText(input.transcript)
  const segments = normalizeSegments(input.transcript.segments)
  if (!sourceText) {
    throw new Error("transcript embedding workflow requires transcript text")
  }

  const maxChunkTokens =
    input.chunking?.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS
  const overlapTokens = input.chunking?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS
  const maxBatchChunks =
    input.chunking?.maxBatchChunks ?? DEFAULT_MAX_BATCH_CHUNKS
  const maxBatchTokens =
    input.chunking?.maxBatchTokens ?? DEFAULT_MAX_BATCH_TOKENS

  const usesSegments = segments != null && segments.length > 0
  const baseChunks = usesSegments
    ? planSegmentChunks(segments, { maxChunkTokens, overlapTokens })
    : planPlainTextChunks(sourceText, { maxChunkTokens, overlapTokens })
  const chunks = baseChunks.map(enrichChunk)

  if (chunks.length === 0) {
    throw new Error("transcript embedding workflow requires at least one chunk")
  }

  const sourceMetadata = {
    kind: input.transcript.kind,
    artifactKey: input.transcript.artifactKey,
    languageId: input.transcript.languageId,
    languageSlug: input.transcript.languageSlug,
    subtitleId: input.transcript.subtitleId,
    format: input.transcript.format,
    url: input.transcript.url,
    provider: input.transcript.provider,
    generatedAt: input.transcript.generatedAt,
  }

  return {
    target: input.target,
    language: input.language,
    mode: input.mode,
    source: {
      text: sourceText,
      segments,
      artifactKey: input.transcript.artifactKey,
      kind: input.transcript.kind,
      languageId: input.transcript.languageId,
      languageSlug: input.transcript.languageSlug,
      subtitleId: input.transcript.subtitleId,
      format: input.transcript.format,
      url: input.transcript.url,
      provider: input.transcript.provider,
      generatedAt: input.transcript.generatedAt,
      contentHash: sourceContentHash({
        text: sourceText,
        segments,
        source: sourceMetadata,
        chunks,
      }),
    },
    model: {
      name: input.model?.name ?? providerConfig.model,
      provider: input.model?.provider ?? providerConfig.provider,
    },
    chunking: {
      type: usesSegments ? "segment-aware" : "plain-text",
      maxChunkTokens,
      overlapTokens,
      maxBatchChunks,
      maxBatchTokens,
      version: input.chunking?.version ?? CHUNKING_VERSION,
    },
    generation: {
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      mastraRunId: options.mastraRunId,
    },
    chunks,
  }
}

export async function embedPlannedTranscript(
  planned: PlannedRun,
  options: TranscriptEmbeddingWorkflowOptions = {},
): Promise<EmbeddedRun> {
  const batches = createBatches(planned.chunks, {
    maxBatchChunks: planned.chunking.maxBatchChunks,
    maxBatchTokens: planned.chunking.maxBatchTokens,
  })
  const chunks: EmbeddedRun["chunks"] = []
  let tokenCount = 0
  let transformVersion: string | undefined
  let nativeDimensions: number | undefined

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!
    const providerConfig = getTranscriptEmbeddingProviderConfig()
    const requestContext = `Transcript embedding batch ${index + 1}/${batches.length}`
    const rawResult = await requestEmbeddingBatchWithFallback(batch, {
      ...options,
      planned,
      providerConfig,
      context: requestContext,
    })
    const result = validateEmbeddingProviderResult(rawResult, batch.length, {
      expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
      context: requestContext,
      itemLabel: "chunks",
    })

    tokenCount += result.tokenCount
    transformVersion ??= result.transformVersion
    nativeDimensions ??= result.nativeDimensions
    chunks.push(
      ...batch.map((chunk, chunkIndex) => ({
        ...chunk,
        embedding: result.embeddings[chunkIndex]!,
      })),
    )
  }

  return {
    ...planned,
    dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    nativeDimensions,
    transformVersion,
    providerTokenCount: tokenCount,
    chunks,
  }
}

function toAdminPayload(
  embedded: EmbeddedRun,
): AdminTranscriptEmbeddingIngestPayload {
  return {
    target: embedded.target,
    language: embedded.language,
    source: embedded.source,
    model: {
      name: embedded.model.name,
      provider: embedded.model.provider,
      dimensions: embedded.dimensions,
      ...(embedded.nativeDimensions
        ? { nativeDimensions: embedded.nativeDimensions }
        : {}),
      ...(embedded.transformVersion
        ? { transformVersion: embedded.transformVersion }
        : {}),
    },
    chunking: {
      type: embedded.chunking.type,
      maxChunkTokens: embedded.chunking.maxChunkTokens,
      overlapTokens: embedded.chunking.overlapTokens,
      version: embedded.chunking.version,
    },
    generation: {
      mode: embedded.mode as TranscriptEmbeddingGenerationMode,
      generatedAt: embedded.generation.generatedAt,
      mastraRunId: embedded.generation.mastraRunId,
    },
    chunks: embedded.chunks,
  }
}

function successFromAdminResult(
  embedded: EmbeddedRun,
  result: AdminTranscriptEmbeddingIngestResult,
): TranscriptEmbeddingWorkflowResult {
  if (result.status === "rejected") {
    return failure("admin_ingest_rejected", {
      mastraRunId: embedded.generation.mastraRunId,
      retryable: false,
      adminStatus: result.status,
      adminReason: result.reason,
    })
  }

  return {
    ok: true,
    status: result.status,
    target: result.target,
    chunks: result.chunks,
    totalTokens: embedded.chunks.reduce(
      (sum, chunk) => sum + chunk.tokenCount,
      0,
    ),
    model: result.model,
    provider: embedded.model.provider,
    dimensions: result.dimensions,
    nativeDimensions: embedded.nativeDimensions,
    transformVersion: embedded.transformVersion,
    mastraRunId: embedded.generation.mastraRunId,
    sourceContentHash: embedded.source.contentHash,
    chunking: {
      type: embedded.chunking.type,
      maxChunkTokens: embedded.chunking.maxChunkTokens,
      overlapTokens: embedded.chunking.overlapTokens,
      version: embedded.chunking.version,
    },
  }
}

export async function submitTranscriptEmbeddingRun(
  embedded: EmbeddedRun,
  options: TranscriptEmbeddingWorkflowOptions = {},
): Promise<TranscriptEmbeddingWorkflowResult> {
  const payload = toAdminPayload(embedded)
  const result = options.adminIngestClient
    ? await options.adminIngestClient(payload)
    : await callAdminTranscriptIngest({
        ingestUrl: options.ingestUrl ?? env.ADMIN_TRANSCRIPT_INGEST_URL,
        bearer:
          options.adminBearer ?? env.ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY,
        payload,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      })

  if (result.ok) {
    return successFromAdminResult(embedded, result.result)
  }

  if (result.reason === "config_missing") {
    return failure("admin_config_missing", {
      mastraRunId: embedded.generation.mastraRunId,
      retryable: false,
    })
  }
  if (result.reason === "auth_failed") {
    return failure("admin_auth_failed", {
      mastraRunId: embedded.generation.mastraRunId,
      retryable: false,
    })
  }
  if (result.reason === "rejected") {
    return failure("admin_ingest_rejected", {
      mastraRunId: embedded.generation.mastraRunId,
      retryable: false,
      adminStatus: result.result?.status ?? String(result.status ?? ""),
      adminReason: result.result?.reason ?? result.adminReason,
    })
  }

  if (
    result.status != null &&
    result.status >= 400 &&
    result.status < 500 &&
    result.status !== 429
  ) {
    return failure("admin_ingest_rejected", {
      mastraRunId: embedded.generation.mastraRunId,
      retryable: false,
      adminStatus: String(result.status),
      adminReason: result.adminReason,
    })
  }

  return failure("admin_ingest_failed", {
    mastraRunId: embedded.generation.mastraRunId,
    retryable: result.retryable,
    adminStatus: result.status == null ? undefined : String(result.status),
    adminReason: result.adminReason,
  })
}

export async function runTranscriptEmbeddingWorkflow(
  rawInput: unknown,
  options: TranscriptEmbeddingWorkflowOptions = {},
): Promise<TranscriptEmbeddingWorkflowResult> {
  const mastraRunId = options.runId ?? randomUUID()
  let planned: PlannedRun
  try {
    planned = planTranscriptEmbeddingRun(rawInput, {
      mastraRunId,
      generatedAt: options.generatedAt,
    })
  } catch {
    return failure("invalid_input", {
      mastraRunId,
      retryable: false,
    })
  }

  let embedded: EmbeddedRun
  try {
    embedded = await embedPlannedTranscript(planned, options)
  } catch (error) {
    return failureFromEmbeddingError(error, mastraRunId)
  }

  return submitTranscriptEmbeddingRun(embedded, options)
}

const planStep = createStep({
  id: "validate-and-plan-transcript-embedding",
  description:
    "Validate transcript source data and summarize deterministic chunk planning.",
  inputSchema: TranscriptEmbeddingWorkflowInputSchema,
  outputSchema: PlannedRunStepOutputSchema,
  execute: async ({ inputData, runId }) => {
    try {
      const planned = planTranscriptEmbeddingRun(inputData, {
        mastraRunId: runId,
      })
      return {
        ok: true,
        summary: summarizePlannedRun(planned),
      } as const
    } catch {
      throwWorkflowFailure(
        failure("invalid_input", { mastraRunId: runId, retryable: false }),
      )
    }
  },
})

function replanFromStepSummary(
  rawInput: unknown,
  summary: z.infer<typeof PlannedRunSummarySchema>,
): PlannedRun {
  return planTranscriptEmbeddingRun(rawInput, {
    mastraRunId: summary.generation.mastraRunId,
    generatedAt: summary.generation.generatedAt,
  })
}

const embedChunksStep = createStep({
  id: "embed-transcript-chunks",
  description:
    "Generate transcript chunk vectors and retain only a scrubbed embedding summary.",
  inputSchema: PlannedRunStepOutputSchema,
  outputSchema: EmbeddedRunStepOutputSchema,
  retries: 2,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok) throwWorkflowFailure(inputData)
    let planned: PlannedRun
    try {
      planned = replanFromStepSummary(getInitData<unknown>(), inputData.summary)
    } catch {
      throwWorkflowFailure(
        failure("invalid_input", {
          mastraRunId: inputData.summary.generation.mastraRunId,
          retryable: false,
        }),
      )
    }

    let embedded: EmbeddedRun
    try {
      embedded = await embedPlannedTranscript(planned)
    } catch (error) {
      throwWorkflowFailure(
        failureFromEmbeddingError(error, planned.generation.mastraRunId),
      )
    }

    embeddedRunByMastraRunId.set(planned.generation.mastraRunId, embedded)
    return {
      ok: true,
      ...summarizeEmbeddedRun(embedded),
    } as const
  },
})

const ingestEmbeddingsStep = createStep({
  id: "ingest-transcript-embeddings",
  description: "Submit transcript vectors to Admin ingest.",
  inputSchema: EmbeddedRunStepOutputSchema,
  outputSchema: TranscriptEmbeddingWorkflowOutputSchema,
  retries: 2,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok) throwWorkflowFailure(inputData)

    let embedded = embeddedRunByMastraRunId.get(
      inputData.summary.generation.mastraRunId,
    )
    if (!embedded) {
      let planned: PlannedRun
      try {
        planned = replanFromStepSummary(
          getInitData<unknown>(),
          inputData.summary,
        )
      } catch {
        throwWorkflowFailure(
          failure("invalid_input", {
            mastraRunId: inputData.summary.generation.mastraRunId,
            retryable: false,
          }),
        )
      }

      try {
        embedded = await embedPlannedTranscript(planned)
      } catch (error) {
        throwWorkflowFailure(
          failureFromEmbeddingError(error, planned.generation.mastraRunId),
        )
      }
    }

    try {
      const result = await submitTranscriptEmbeddingRun(embedded)
      if (!result.ok) {
        throwWorkflowFailure(result)
      }
      return result
    } finally {
      embeddedRunByMastraRunId.delete(inputData.summary.generation.mastraRunId)
    }
  },
})

export const transcriptEmbeddingWorkflow = createWorkflow({
  id: "transcript-embedding",
  description:
    "Plan transcript chunks, generate embeddings, and store them through Admin ingest.",
  inputSchema: TranscriptEmbeddingWorkflowInputSchema,
  outputSchema: TranscriptEmbeddingWorkflowOutputSchema,
})
  .then(planStep)
  .then(embedChunksStep)
  .then(ingestEmbeddingsStep)
  .commit()

export async function launchTranscriptEmbeddingWorkflow(
  rawInput: unknown,
  options: TranscriptEmbeddingWorkflowOptions = {},
): Promise<TranscriptEmbeddingWorkflowResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = TranscriptEmbeddingWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", { mastraRunId: runId, retryable: false })
  }

  const run = await transcriptEmbeddingWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      workflowFailureFromUnknown(error) ??
      failure("admin_ingest_failed", { mastraRunId: runId, retryable: true })
    )
  }
  if (result.status === "success") {
    return result.result
  }
  return (
    workflowFailureFromRunResult(result) ??
    failure("admin_ingest_failed", { mastraRunId: runId, retryable: true })
  )
}

function routeStatusForResult(result: TranscriptEmbeddingWorkflowResult) {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "admin_ingest_rejected") {
    const adminStatus = Number(result.adminStatus)
    if (adminStatus >= 400 && adminStatus < 500) return adminStatus
    return 409
  }
  if (
    result.reason === "provider_config_missing" ||
    result.reason === "admin_config_missing"
  ) {
    return 503
  }
  return 502
}

export async function handleTranscriptEmbeddingRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchTranscriptEmbeddingWorkflow,
}: RouteHandlerInput): Promise<TranscriptEmbeddingRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return {
      status: 401,
      body: { error: "Service bearer required" },
    }
  }

  const body = await readJson().catch(() => undefined)
  const envelope = routeRequestEnvelope(body)
  const result =
    body === undefined
      ? failure("invalid_input", {
          mastraRunId: envelope.runId,
          retryable: false,
        })
      : await launch(envelope.input, { runId: envelope.runId })

  return {
    status: routeStatusForResult(result),
    body: { result },
  }
}

export const _internals = {
  estimateTokenCount,
  planPlainTextChunks,
  planSegmentChunks,
  createBatches,
  sourceContentHash,
  summarizePlannedRun,
  toAdminPayload,
  CHUNKING_VERSION,
  workflowFailureFromRunResult,
  routeRequestEnvelope,
}
