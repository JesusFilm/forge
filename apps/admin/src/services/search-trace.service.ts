import {
  SearchTraceLatencyBucket as PrismaSearchTraceLatencyBucket,
  SearchTraceOutcome as PrismaSearchTraceOutcome,
  SearchTraceRouteSource as PrismaSearchTraceRouteSource,
  type Prisma,
  type PrismaClient,
} from "@prisma/client"
import { after } from "next/server"
import { env } from "@/config/env"
import { prisma as defaultPrisma } from "@/db/client"
import {
  getSearchTraceHealthCounters,
  recordSearchTraceRawCaptureDisabled,
  recordSearchTraceWriteFailure,
  recordSearchTraceWriteSuccess,
  recordSearchTraceWriteTimeout,
} from "@/services/search-trace-health"
import {
  classifySearchTraceQuery,
  isSearchTraceAbuseLabel,
  isSearchTraceQueryQualityLabel,
  isSearchTraceSensitiveQueryLabel,
  type SearchTraceAbuseLabel,
  type SearchTraceQueryQualityLabel,
  type SearchTraceSensitiveQueryLabel,
} from "@/services/search-trace-privacy"
import {
  purgeExpiredSearchTraces,
  readSearchTraceRetentionHealth,
} from "@/services/search-trace-retention.service"
import { BoundedSearchTraceWriteQueue } from "@/services/search-trace-write-queue"
import type {
  WatchSearchInput,
  WatchSearchLaneStatus,
  WatchSearchResponse,
  WatchSearchResult,
} from "@/services/watch-search.service"

export type SearchTraceRouteSourceLabel = "rest" | "graphql"
export type SearchTraceOutcomeLabel = "success" | "degraded" | "failed"
export type SearchTraceLatencyBucketLabel =
  | "lt_100ms"
  | "lt_250ms"
  | "lt_500ms"
  | "lt_1000ms"
  | "lt_2500ms"
  | "gte_2500ms"

export type RecordSearchTraceInput = {
  requestId?: string | null
  query: string
  locale: string
  routeSource: SearchTraceRouteSourceLabel
  requestedMode?: string | null
  searchMode: string
  resultCount: number
  outcome: SearchTraceOutcomeLabel
  traceClass?: string | null
  startedAt: Date
  completedAt: Date
  metadata?: Prisma.InputJsonValue | null
  now?: Date
  timeoutMs?: number
  retentionHealthy?: boolean
  storeAggregate?: boolean
  sampleEligible?: boolean
}

export type SearchTraceWriteResult = {
  aggregateStored: boolean
  rawStored: boolean
  rawCaptureDisabled: boolean
}

export type SearchTraceSafeRecordResult =
  | (SearchTraceWriteResult & { ok: true; timedOut: false })
  | { ok: false; timedOut: true }
  | { ok: false; timedOut: false }

export type SearchTraceSampleFilters = {
  locale?: string
  routeSource?: SearchTraceRouteSourceLabel
  searchMode?: string
  queryQualityLabels?: SearchTraceQueryQualityLabel[]
  sensitiveQueryLabels?: SearchTraceSensitiveQueryLabel[]
  abuseLabels?: SearchTraceAbuseLabel[]
  llmClassification?: "any" | "classified" | "unclassified" | "candidates"
  since?: Date
  until?: Date
  limit?: number
}

export type SearchTraceSample = {
  id: string
  queryText: string
  locale: string
  routeSource: SearchTraceRouteSourceLabel
  requestedMode: string | null
  searchMode: string
  resultCount: number
  latencyBucket: SearchTraceLatencyBucketLabel
  outcome: SearchTraceOutcomeLabel
  traceClass: string
  queryQualityLabel: string
  sensitiveQueryLabel: string
  abuseLabel: string
  queryLabelSource: string
  queryLabelVersion: string
  queryLabeledAt: string
  llmQueryQualityLabel: string | null
  llmAbuseLabel: string | null
  llmLabelSource: string | null
  llmLabelVersion: string | null
  llmLabelReason: string | null
  llmLabeledAt: string | null
  rawExpiresAt: string
  createdAt: string
}

export type RecordWatchSearchTraceInput = {
  input: WatchSearchInput
  response: WatchSearchResponse
  startedAt: Date
  completedAt: Date
  traceRole?: "primary" | "shadow"
  shadowOfRequestId?: string | null
  now?: Date
  timeoutMs?: number
  retentionHealthy?: boolean
}

export type AdminVideoLibrarySearchTraceClient =
  | "experience-editor-video-picker"
  | "experience-editor-video-carousel-picker"
  | "experience-editor-media-collection-picker"

export type RecordAdminVideoLibrarySearchTraceInput = {
  query: string
  locale: string
  client: AdminVideoLibrarySearchTraceClient
  response?: WatchSearchResponse | null
  resultIds?: readonly string[]
  hydratedResultCount?: number
  targetLanguageSlug?: string | null
  startedAt: Date
  completedAt: Date
  outcome?: SearchTraceOutcomeLabel
  traceClass?: string | null
  now?: Date
  timeoutMs?: number
  retentionHealthy?: boolean
}

const TRACE_RECORD_TIMEOUT_MS = 250
const WATCH_TRACE_QUEUE_CONCURRENCY = 1
const WATCH_TRACE_QUEUE_CAPACITY = 256
const DEFAULT_SAMPLE_LIMIT = 50
const MAX_SAMPLE_LIMIT = 100
const MAX_SAMPLE_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_RAW_RETENTION_DAYS = 29
export const SEARCH_TRACE_LLM_HIGH_IMPACT_RESULT_COUNT = 20

export function classifyLatencyBucket(
  latencyMs: number,
): SearchTraceLatencyBucketLabel {
  if (latencyMs < 100) return "lt_100ms"
  if (latencyMs < 250) return "lt_250ms"
  if (latencyMs < 500) return "lt_500ms"
  if (latencyMs < 1000) return "lt_1000ms"
  if (latencyMs < 2500) return "lt_2500ms"
  return "gte_2500ms"
}

function toPrismaRouteSource(
  value: SearchTraceRouteSourceLabel,
): PrismaSearchTraceRouteSource {
  return value === "rest"
    ? PrismaSearchTraceRouteSource.REST
    : PrismaSearchTraceRouteSource.GRAPHQL
}

function toPrismaOutcome(
  value: SearchTraceOutcomeLabel,
): PrismaSearchTraceOutcome {
  if (value === "success") return PrismaSearchTraceOutcome.SUCCESS
  if (value === "degraded") return PrismaSearchTraceOutcome.DEGRADED
  return PrismaSearchTraceOutcome.FAILED
}

function toPrismaLatencyBucket(
  value: SearchTraceLatencyBucketLabel,
): PrismaSearchTraceLatencyBucket {
  switch (value) {
    case "lt_100ms":
      return PrismaSearchTraceLatencyBucket.LT_100_MS
    case "lt_250ms":
      return PrismaSearchTraceLatencyBucket.LT_250_MS
    case "lt_500ms":
      return PrismaSearchTraceLatencyBucket.LT_500_MS
    case "lt_1000ms":
      return PrismaSearchTraceLatencyBucket.LT_1000_MS
    case "lt_2500ms":
      return PrismaSearchTraceLatencyBucket.LT_2500_MS
    case "gte_2500ms":
      return PrismaSearchTraceLatencyBucket.GTE_2500_MS
  }
}

function fromRouteSource(value: string): SearchTraceRouteSourceLabel {
  return value === "REST" || value === "rest" ? "rest" : "graphql"
}

function fromOutcome(value: string): SearchTraceOutcomeLabel {
  if (value === "SUCCESS" || value === "success") return "success"
  if (value === "DEGRADED" || value === "degraded") return "degraded"
  return "failed"
}

function fromLatencyBucket(value: string): SearchTraceLatencyBucketLabel {
  switch (value) {
    case "LT_100_MS":
    case "lt_100ms":
      return "lt_100ms"
    case "LT_250_MS":
    case "lt_250ms":
      return "lt_250ms"
    case "LT_500_MS":
    case "lt_500ms":
      return "lt_500ms"
    case "LT_1000_MS":
    case "lt_1000ms":
      return "lt_1000ms"
    case "LT_2500_MS":
    case "lt_2500ms":
      return "lt_2500ms"
    default:
      return "gte_2500ms"
  }
}

function clampString(value: string | null | undefined, max: number): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim()
  return normalized.slice(0, max)
}

function traceClassOrNone(value: string | null | undefined): string {
  return clampString(value, 64) || "none"
}

function normalizeMode(value: string | null | undefined): string | null {
  const normalized = clampString(value, 64)
  return normalized.length === 0 ? null : normalized
}

function normalizeLocale(value: string): string {
  return clampString(value, 32) || "unknown"
}

function normalizeRequestId(value: string | null | undefined): string | null {
  const normalized = clampString(value, 80)
  return /^[A-Za-z0-9_-]{8,80}$/.test(normalized) ? normalized : null
}

function watchTraceClass(response: WatchSearchResponse): string {
  const classes = new Set<string>()
  if (response.results.length === 0) classes.add("no_result")
  for (const lane of response.laneStatuses) {
    if (lane.status === "fulfilled") continue
    classes.add(`${lane.lane}_${lane.status}`)
    if (lane.reason) classes.add(lane.reason)
  }
  if (classes.size === 0) return "none"
  return traceClassOrNone(Array.from(classes).join("+"))
}

function safeLaneStatusMetadata(
  lane: WatchSearchLaneStatus,
): Prisma.InputJsonObject {
  return {
    lane: lane.lane,
    status: lane.status,
    startedOffsetMs: lane.startedOffsetMs,
    elapsedMs: lane.elapsedMs,
    resultCount: lane.resultCount,
    reason: lane.reason,
    detail: lane.detail,
  }
}

function availabilityScoreForKind(
  kind: WatchSearchResult["availability"]["kind"],
): number {
  if (kind === "target_audio") return 0.25
  if (kind === "target_subtitle") return 0.18
  if (kind === "related_language") return 0.08
  return 0
}

function safeResultMetadata(row: WatchSearchResult): Prisma.InputJsonObject {
  const availability = availabilityScoreForKind(row.availability.kind)
  return {
    id: row.id,
    type: row.type,
    score: row.score,
    scoreBreakdown: {
      total: row.scoreBreakdown.total,
      sourceRelevance: row.scoreBreakdown.sourceRelevance,
      evidenceBoost: row.scoreBreakdown.evidenceBoost,
      relevance: row.scoreBreakdown.relevance,
      availability,
      match: row.scoreBreakdown.match,
      sourceScore: row.scoreBreakdown.sourceScore,
    },
    availabilityKind: row.availability.kind,
    availabilityLanguageSlug: row.availability.languageSlug,
    evidenceKind: row.evidence.kind,
    evidenceLanguageSlug: row.evidence.languageSlug,
    actionKind: row.action.kind,
    actionLanguageSlug: row.action.hrefLanguageSlug,
  }
}

function watchSearchTraceMetadata(
  input: WatchSearchInput,
  response: WatchSearchResponse,
  traceRole: "primary" | "shadow",
  shadowOfRequestId: string | null,
): Prisma.InputJsonObject {
  const language = response.languageInterpretation
  return {
    version: "watch-search-analytics/v3",
    requestId: response.requestId,
    traceRole,
    shadowOfRequestId,
    queryLength: response.query.length,
    limit: input.limit ?? null,
    offset: input.offset ?? null,
    resultTypes: input.resultTypes == null ? null : [...input.resultTypes],
    resultCount: response.results.length,
    hasMore: response.hasMore,
    noResult: response.results.length === 0,
    degraded: response.degraded,
    latencyMs: response.latencyMs,
    nextOffset: response.nextOffset,
    language: {
      targetLanguageSlug: language.targetLanguageSlug,
      targetLanguageSource: language.targetLanguageSource,
      queryLanguageSlug: language.queryLanguageSlug,
      queryNamedLanguageSlug: language.queryNamedLanguageSlug,
      displayLanguageSlug: language.displayLanguageSlug,
      routeLanguageSlug: language.routeLanguageSlug,
      currentWatchLanguageSlug: language.currentWatchLanguageSlug,
      acceptLanguageSlug: language.acceptLanguageSlug,
    },
    laneStatuses: response.laneStatuses.map(safeLaneStatusMetadata),
    results: response.results.slice(0, 50).map(safeResultMetadata),
  }
}

function safeTraceTokens(values: readonly string[] | undefined): string[] {
  if (!values?.length) return []
  return values
    .flatMap((value) => {
      const normalized = clampString(value, 128)
      return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)
        ? [normalized]
        : []
    })
    .slice(0, 50)
}

function normalizeAdminVideoLibrarySearchClient(
  value: AdminVideoLibrarySearchTraceClient,
): AdminVideoLibrarySearchTraceClient {
  if (
    value === "experience-editor-media-collection-picker" ||
    value === "experience-editor-video-carousel-picker" ||
    value === "experience-editor-video-picker"
  ) {
    return value
  }
  return "experience-editor-video-picker"
}

function adminVideoLibraryTraceMetadata(
  input: RecordAdminVideoLibrarySearchTraceInput,
): Prisma.InputJsonObject {
  const response = input.response ?? null
  const client = normalizeAdminVideoLibrarySearchClient(input.client)
  const resultIds =
    input.resultIds ??
    response?.results
      .filter((result) => result.type === "video")
      .map((result) => result.id) ??
    []

  return {
    version: "admin-video-library-search/v1",
    client,
    requestId: response?.requestId ?? null,
    queryLength: input.query.length,
    targetLanguageSlug:
      input.targetLanguageSlug ??
      response?.languageInterpretation.targetLanguageSlug ??
      null,
    resultTypes: ["video"],
    resultCount: response?.results.length ?? resultIds.length,
    hydratedResultCount: input.hydratedResultCount ?? null,
    degraded: response?.degraded ?? input.outcome === "degraded",
    resultIds: safeTraceTokens(resultIds),
  }
}

function floorToHour(value: Date): Date {
  const bucket = new Date(value)
  bucket.setUTCMinutes(0, 0, 0)
  return bucket
}

function rawRetentionDays(): number {
  const days = env.SEARCH_TRACE_RAW_RETENTION_DAYS
  if (Number.isInteger(days) && days >= 1 && days <= 29) return days
  return DEFAULT_RAW_RETENTION_DAYS
}

function addRetentionDays(value: Date): Date {
  return new Date(value.getTime() + rawRetentionDays() * 24 * 60 * 60 * 1000)
}

function latencyMs(input: RecordSearchTraceInput): number {
  return Math.max(0, input.completedAt.getTime() - input.startedAt.getTime())
}

async function shouldStoreRawTrace(
  prisma: PrismaClient,
  input: RecordSearchTraceInput,
): Promise<boolean> {
  if (typeof input.retentionHealthy === "boolean") return input.retentionHealthy
  if (env.NODE_ENV !== "production") return true
  const health = await readSearchTraceRetentionHealth(prisma)
  if (health.healthy) return true

  await purgeExpiredSearchTraces(prisma, input.now ?? input.completedAt)
  console.warn(
    `[search] event=trace_retention_inline_purge route=${input.routeSource} reason=${health.reason}`,
  )
  return true
}

export async function writeSearchTrace(
  input: RecordSearchTraceInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<SearchTraceWriteResult> {
  const completedAt = input.completedAt
  const createdAt = input.now ?? completedAt
  const routeSource = toPrismaRouteSource(input.routeSource)
  const outcome = toPrismaOutcome(input.outcome)
  const latencyBucket = toPrismaLatencyBucket(
    classifyLatencyBucket(latencyMs(input)),
  )
  const locale = normalizeLocale(input.locale)
  const requestId = normalizeRequestId(input.requestId)
  const requestedMode = normalizeMode(input.requestedMode)
  const searchMode = clampString(input.searchMode, 64) || "unknown"
  const traceClass = traceClassOrNone(input.traceClass)
  const privacy = classifySearchTraceQuery(input.query, createdAt)
  const aggregateDimensions = {
    bucketStart: floorToHour(completedAt),
    routeSource,
    locale,
    searchMode,
    outcome,
    traceClass,
    latencyBucket,
    queryQualityLabel: privacy.queryQualityLabel,
    sensitiveQueryLabel: privacy.sensitiveQueryLabel,
    abuseLabel: privacy.abuseLabel,
    queryLabelSource: privacy.labelSource,
    queryLabelVersion: privacy.labelVersion,
  }
  const aggregatePromise =
    input.storeAggregate === false
      ? Promise.resolve(null)
      : prisma.searchTraceAggregate.upsert({
          where: {
            searchTraceAggregateBucketDims: aggregateDimensions,
          },
          create: {
            ...aggregateDimensions,
            queryCount: 1,
            resultCountSum: input.resultCount,
          },
          update: {
            queryCount: { increment: 1 },
            resultCountSum: { increment: input.resultCount },
          },
        })

  const rawEnabled = await shouldStoreRawTrace(prisma, input)
  const rawPromise = rawEnabled
    ? prisma.searchTrace.create({
        data: {
          requestId,
          queryText: privacy.queryText,
          locale,
          routeSource,
          requestedMode,
          searchMode,
          resultCount: input.resultCount,
          latencyBucket,
          outcome,
          traceClass,
          queryQualityLabel: privacy.queryQualityLabel,
          sensitiveQueryLabel: privacy.sensitiveQueryLabel,
          abuseLabel: privacy.abuseLabel,
          queryLabelSource: privacy.labelSource,
          queryLabelVersion: privacy.labelVersion,
          queryLabeledAt: privacy.labeledAt,
          sampleEligible: input.sampleEligible ?? privacy.sampleEligible,
          metadata: input.metadata ?? undefined,
          startedAt: input.startedAt,
          completedAt,
          rawExpiresAt: addRetentionDays(createdAt),
          createdAt,
        },
      })
    : Promise.resolve(null)

  const [aggregateResult, rawResult] = await Promise.allSettled([
    aggregatePromise,
    rawPromise,
  ])
  if (aggregateResult.status === "rejected") throw aggregateResult.reason
  if (rawResult.status === "rejected") throw rawResult.reason

  if (!rawEnabled) {
    recordSearchTraceRawCaptureDisabled()
    console.warn(
      `[search] event=trace_raw_capture_disabled route=${input.routeSource} outcome=${input.outcome}`,
    )
  }

  return {
    aggregateStored: input.storeAggregate !== false,
    rawStored: rawEnabled,
    rawCaptureDisabled: !rawEnabled,
  }
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : "UnknownError"
}

function safeTraceErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "unknown"
  const diagnosticLines = error.message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      /^(Unknown argument|Invalid value|Argument .* is missing|Argument .* must not be|Provided|Expected|Available options)/.test(
        line,
      ),
    )
    .map((line) => line.replace(/: .+$/, ""))
  const message =
    diagnosticLines.length > 0 ? diagnosticLines.join(" ") : error.message
  return message.replace(/[\r\n\t]/g, " ").slice(0, 300)
}

export async function recordSearchTraceSafely(
  input: RecordSearchTraceInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<SearchTraceSafeRecordResult> {
  const timeoutMs = input.timeoutMs ?? TRACE_RECORD_TIMEOUT_MS
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false

  const writePromise = recordSearchTraceToCompletionSafely(input, prisma)
  const timeoutPromise = new Promise<SearchTraceSafeRecordResult>((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true
      recordSearchTraceWriteTimeout()
      console.warn(
        `[search] event=trace_record_timeout route=${input.routeSource} outcome=${input.outcome} timeout_ms=${timeoutMs}`,
      )
      resolve({ ok: false, timedOut: true })
    }, timeoutMs)
  })

  const result = await Promise.race([writePromise, timeoutPromise])
  if (!timedOut && timeout) clearTimeout(timeout)
  return result
}

async function recordSearchTraceToCompletionSafely(
  input: RecordSearchTraceInput,
  prisma: PrismaClient,
): Promise<SearchTraceSafeRecordResult> {
  return writeSearchTrace(input, prisma)
    .then((result) => {
      recordSearchTraceWriteSuccess()
      return { ok: true as const, timedOut: false as const, ...result }
    })
    .catch((error) => {
      recordSearchTraceWriteFailure()
      console.warn(
        `[search] event=trace_record_failed route=${input.routeSource} outcome=${input.outcome} error_class=${errorClass(error)} message=${safeTraceErrorMessage(error)}`,
      )
      return { ok: false as const, timedOut: false as const }
    })
}

function watchSearchTraceInput(
  input: RecordWatchSearchTraceInput,
): RecordSearchTraceInput {
  const response = input.response
  const traceRole = input.traceRole ?? "primary"
  return {
    requestId: response.requestId,
    query: response.query,
    locale: response.languageInterpretation.targetLanguageSlug,
    routeSource: "graphql",
    requestedMode: input.input.mode ?? "default",
    searchMode: response.searchMode,
    resultCount: response.results.length,
    outcome: response.degraded ? "degraded" : "success",
    traceClass: watchTraceClass(response),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    metadata: watchSearchTraceMetadata(
      input.input,
      response,
      traceRole,
      normalizeRequestId(input.shadowOfRequestId),
    ),
    now: input.now,
    timeoutMs: input.timeoutMs,
    retentionHealthy: input.retentionHealthy,
    storeAggregate: traceRole !== "shadow",
    sampleEligible: traceRole === "shadow" ? false : undefined,
  }
}

export async function recordWatchSearchTraceSafely(
  input: RecordWatchSearchTraceInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<SearchTraceSafeRecordResult> {
  return recordSearchTraceSafely(watchSearchTraceInput(input), prisma)
}

/**
 * Queue workers already provide bounded concurrency and must hold their slot
 * until persistence settles. Unlike the request-oriented safe recorder, this
 * variant does not release the worker after the short trace timeout while the
 * database write is still running.
 */
export async function recordWatchSearchTraceToCompletionSafely(
  input: RecordWatchSearchTraceInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<SearchTraceSafeRecordResult> {
  return recordSearchTraceToCompletionSafely(
    watchSearchTraceInput(input),
    prisma,
  )
}

type QueuedWatchSearchTrace = {
  input: RecordWatchSearchTraceInput
  prisma: PrismaClient
}

const watchSearchTraceWriteQueue = new BoundedSearchTraceWriteQueue({
  concurrency: WATCH_TRACE_QUEUE_CONCURRENCY,
  maxPending: WATCH_TRACE_QUEUE_CAPACITY,
  worker: async ({ input, prisma }: QueuedWatchSearchTrace) => {
    await recordSearchTraceToCompletionSafely(
      watchSearchTraceInput(input),
      prisma,
    )
  },
})

export function enqueueWatchSearchTrace(
  input: RecordWatchSearchTraceInput,
  prisma: PrismaClient = defaultPrisma,
): boolean {
  const completion = watchSearchTraceWriteQueue.enqueueWithCompletion({
    input,
    prisma,
  })
  if (!completion) {
    recordSearchTraceWriteFailure()
    console.warn(
      `[search] event=trace_queue_full route=graphql outcome=${input.response.degraded ? "degraded" : "success"} capacity=${WATCH_TRACE_QUEUE_CAPACITY}`,
    )
    return false
  }
  try {
    after(() => completion)
  } catch {
    void completion
  }
  return true
}

export async function recordAdminVideoLibrarySearchTraceSafely(
  input: RecordAdminVideoLibrarySearchTraceInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<SearchTraceSafeRecordResult> {
  const response = input.response ?? null
  const client = normalizeAdminVideoLibrarySearchClient(input.client)
  const resultCount = response?.results.length ?? input.resultIds?.length ?? 0
  const outcome = input.outcome ?? (response?.degraded ? "degraded" : "success")

  return recordSearchTraceSafely(
    {
      requestId: response?.requestId,
      query: input.query,
      locale: input.locale,
      routeSource: "graphql",
      requestedMode: client,
      searchMode: response?.searchMode ?? "admin-video-library",
      resultCount,
      outcome,
      traceClass: input.traceClass ?? "none",
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      metadata: adminVideoLibraryTraceMetadata(input),
      now: input.now,
      timeoutMs: input.timeoutMs,
      retentionHealthy: input.retentionHealthy,
    },
    prisma,
  )
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_SAMPLE_LIMIT
  return Math.min(MAX_SAMPLE_LIMIT, Math.max(1, Math.floor(limit)))
}

function sampleWindow(
  filters: SearchTraceSampleFilters,
  now: Date,
): { since: Date; until: Date } {
  const until =
    filters.until && filters.until < now ? filters.until : new Date(now)
  const requestedSince =
    filters.since && filters.since < until
      ? filters.since
      : new Date(until.getTime() - MAX_SAMPLE_WINDOW_MS)
  const minimumSince = new Date(until.getTime() - MAX_SAMPLE_WINDOW_MS)
  return {
    since: requestedSince < minimumSince ? minimumSince : requestedSince,
    until,
  }
}

const DEFAULT_QUERY_QUALITY_LABELS: SearchTraceQueryQualityLabel[] = [
  "valid_viewer_intent",
]
const DEFAULT_SENSITIVE_QUERY_LABELS: SearchTraceSensitiveQueryLabel[] = [
  "none",
]
const DEFAULT_ABUSE_LABELS: SearchTraceAbuseLabel[] = ["none"]

function uniqueValidLabels<T extends string>(
  labels: T[] | undefined,
  isValid: (value: string) => value is T,
  fallback: T[],
): T[] {
  if (labels == null || labels.length === 0) return fallback
  const valid = labels.filter((label): label is T => isValid(label))
  return Array.from(new Set(valid.length > 0 ? valid : fallback))
}

function defaultQueryQualityLabels(
  filters: SearchTraceSampleFilters,
): SearchTraceQueryQualityLabel[] {
  if (filters.llmClassification === "candidates") {
    return ["valid_viewer_intent", "unknown_ambiguous"]
  }
  return DEFAULT_QUERY_QUALITY_LABELS
}

function isDefaultSamplingContract(
  queryQualityLabels: SearchTraceQueryQualityLabel[],
  sensitiveQueryLabels: SearchTraceSensitiveQueryLabel[],
  abuseLabels: SearchTraceAbuseLabel[],
): boolean {
  return (
    queryQualityLabels.length === 1 &&
    queryQualityLabels[0] === "valid_viewer_intent" &&
    sensitiveQueryLabels.length === 1 &&
    sensitiveQueryLabels[0] === "none" &&
    abuseLabels.length === 1 &&
    abuseLabels[0] === "none"
  )
}

function applyLlmClassificationFilter(
  where: Prisma.SearchTraceWhereInput,
  filter: SearchTraceSampleFilters["llmClassification"],
): void {
  if (filter == null || filter === "any") return
  if (filter === "classified") {
    where.llmLabelSource = { not: null }
    return
  }

  where.llmLabelSource = null
  if (filter === "candidates") {
    where.OR = [
      { queryQualityLabel: "unknown_ambiguous" },
      { resultCount: { gte: SEARCH_TRACE_LLM_HIGH_IMPACT_RESULT_COUNT } },
    ]
  }
}

function shouldReturnSampleQueryText(row: {
  sensitiveQueryLabel: string
  abuseLabel: string
}): boolean {
  return row.sensitiveQueryLabel === "none" && row.abuseLabel === "none"
}

type SearchTraceSampleRow = {
  id: string
  queryText: string
  locale: string
  routeSource: string
  requestedMode: string | null
  searchMode: string
  resultCount: number
  latencyBucket: string
  outcome: string
  traceClass: string
  queryQualityLabel: string
  sensitiveQueryLabel: string
  abuseLabel: string
  queryLabelSource: string
  queryLabelVersion: string
  queryLabeledAt: Date
  llmQueryQualityLabel: string | null
  llmAbuseLabel: string | null
  llmLabelSource: string | null
  llmLabelVersion: string | null
  llmLabelReason: string | null
  llmLabeledAt: Date | null
  rawExpiresAt: Date
  createdAt: Date
}

export async function sampleSearchTraces(
  prisma: PrismaClient,
  filters: SearchTraceSampleFilters = {},
  now: Date = new Date(),
): Promise<SearchTraceSample[]> {
  const { since, until } = sampleWindow(filters, now)
  const queryQualityLabels = uniqueValidLabels(
    filters.queryQualityLabels,
    isSearchTraceQueryQualityLabel,
    defaultQueryQualityLabels(filters),
  )
  const sensitiveQueryLabels = uniqueValidLabels(
    filters.sensitiveQueryLabels,
    isSearchTraceSensitiveQueryLabel,
    DEFAULT_SENSITIVE_QUERY_LABELS,
  )
  const abuseLabels = uniqueValidLabels(
    filters.abuseLabels,
    isSearchTraceAbuseLabel,
    DEFAULT_ABUSE_LABELS,
  )
  const where: Prisma.SearchTraceWhereInput = {
    rawExpiresAt: { gt: now },
    createdAt: { gte: since, lte: until },
    queryQualityLabel: { in: queryQualityLabels },
    sensitiveQueryLabel: { in: sensitiveQueryLabels },
    abuseLabel: { in: abuseLabels },
  }
  if (
    isDefaultSamplingContract(
      queryQualityLabels,
      sensitiveQueryLabels,
      abuseLabels,
    )
  ) {
    where.sampleEligible = true
  }
  if (filters.locale) where.locale = normalizeLocale(filters.locale)
  if (filters.routeSource)
    where.routeSource = toPrismaRouteSource(filters.routeSource)
  if (filters.searchMode) where.searchMode = clampString(filters.searchMode, 64)
  applyLlmClassificationFilter(where, filters.llmClassification)

  const rows = (await prisma.searchTrace.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: clampLimit(filters.limit),
    select: {
      id: true,
      queryText: true,
      locale: true,
      routeSource: true,
      requestedMode: true,
      searchMode: true,
      resultCount: true,
      latencyBucket: true,
      outcome: true,
      traceClass: true,
      queryQualityLabel: true,
      sensitiveQueryLabel: true,
      abuseLabel: true,
      queryLabelSource: true,
      queryLabelVersion: true,
      queryLabeledAt: true,
      llmQueryQualityLabel: true,
      llmAbuseLabel: true,
      llmLabelSource: true,
      llmLabelVersion: true,
      llmLabelReason: true,
      llmLabeledAt: true,
      rawExpiresAt: true,
      createdAt: true,
    },
  })) as unknown as SearchTraceSampleRow[]

  return rows.map((row) => ({
    id: row.id,
    queryText: shouldReturnSampleQueryText(row)
      ? row.queryText
      : "[redacted-sample-query]",
    locale: row.locale,
    routeSource: fromRouteSource(row.routeSource),
    requestedMode: row.requestedMode,
    searchMode: row.searchMode,
    resultCount: row.resultCount,
    latencyBucket: fromLatencyBucket(row.latencyBucket),
    outcome: fromOutcome(row.outcome),
    traceClass: row.traceClass,
    queryQualityLabel: row.queryQualityLabel,
    sensitiveQueryLabel: row.sensitiveQueryLabel,
    abuseLabel: row.abuseLabel,
    queryLabelSource: row.queryLabelSource,
    queryLabelVersion: row.queryLabelVersion,
    queryLabeledAt: row.queryLabeledAt.toISOString(),
    llmQueryQualityLabel: row.llmQueryQualityLabel,
    llmAbuseLabel: row.llmAbuseLabel,
    llmLabelSource: row.llmLabelSource,
    llmLabelVersion: row.llmLabelVersion,
    llmLabelReason: row.llmLabelReason,
    llmLabeledAt: row.llmLabeledAt?.toISOString() ?? null,
    rawExpiresAt: row.rawExpiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }))
}

export function getSearchTraceCaptureStats() {
  return getSearchTraceHealthCounters()
}
