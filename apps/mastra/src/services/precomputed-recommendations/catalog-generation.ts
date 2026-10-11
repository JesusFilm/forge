import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"

import {
  createAstraModel,
  isAstraAccessFailure,
  PRECOMPUTED_MODEL_ID,
  type ModelUsage,
  type StructuredModel,
} from "./astra-provider"
import {
  CONTENT_SYSTEM,
  HISTORY_SYSTEM,
  assertEvidence,
  evidenceValidationFeedback,
  createAdminSourceDependencies,
  digest,
  analyticsQueryPlanSchema,
  discoverySchema,
  judgmentSchema,
  modelVideo,
  pages,
  summarySchema,
  type Judgment,
  type EvidenceValidationFeedback,
  type SourceCatalog,
  type SourceIngest,
  type Video,
} from "./source-generation"
import {
  HistoricalAnalyticsError,
  readHistoricalDefinition,
  readHistoricalSnapshot,
  type HistoricalAnalyticsReader,
  type HistoricalSnapshot,
} from "./historical-analytics"
import { createGaWatchHistoryReader } from "./ga-watch-history"
import {
  fetchGaPhysical,
  settleGaPhysicalFailure,
} from "./ga-physical-transport"
import {
  gaCaptureCanonicalJson,
  gaCaptureDigest,
  openGaWatchCaptureArtifact,
  type GaCaptureHeader,
} from "./ga-watch-capture-artifact"
import {
  assertGaCaptureHeaderBinding,
  captureGaWatchAggregates,
  createSealedGaWatchHistoryReader,
  type GaWatchCaptureBinding,
} from "./ga-watch-capture"
import {
  createAdminGaCaptureTransport,
  parseGaCaptureSnapshotRef,
  type GaCaptureTransport,
  type GaCaptureSnapshotRef,
} from "./ga-watch-capture-transport"
import type { WatchRouteCatalogVideo } from "./watch-route-identity"
import {
  GA_WATCH_PROPERTY,
  gaWatchClosedRangeEnd,
} from "./ga-watch-history-range"
import { env } from "../../config/env"
import {
  buildCandidateRetrieval,
  CANDIDATE_RETRIEVAL_REVISION,
} from "./candidate-retrieval"
import {
  buildTranscriptSpanOffer,
  materializeSpanJudgment,
  spanJudgmentSchema,
} from "./catalog-evidence-spans"

const id = z.string().trim().min(1).max(191)
const MAX_CANDIDATE_JUDGMENT_ATTEMPTS = 2
const MAX_ANALYTICS_PLAN_ATTEMPTS = 2
const HISTORY_PROMPT_VERSION = "astra-catalog-history-navigation-v6"
const CAPTURE_HISTORY_PROMPT_VERSION = "astra-catalog-history-capture-v1"
const CONTENT_PROMPT_VERSION = "astra-catalog-v5"
export const CatalogGenerationInputSchema = z
  .object({
    generationId: id,
    inputCutoff: z.string().datetime(),
    historyRequired: z.boolean().default(true),
    snapshotMode: z.literal("ga_aggregate_capture_v1").optional(),
    sourceConcurrency: z.number().int().min(1).max(4).default(1),
    capacity: z
      .object({
        measuredAt: z.string().datetime(),
        clusterSystemId: z.string().regex(/^\d{1,20}$/u),
        observedDbBytes: z.number().int().nonnegative().safe(),
        availableBytes: z.number().int().nonnegative().safe(),
        reserveBytes: z.number().int().nonnegative().safe(),
        projectedBytes: z.number().int().nonnegative().safe(),
        sampleSourceCount: z.number().int().positive().safe(),
        sampleBytes: z.number().int().positive().safe(),
        source: z.literal("operator_verified_pgdata_df"),
      })
      .strict(),
  })
  .strict()
export type CatalogGenerationInput = z.output<
  typeof CatalogGenerationInputSchema
>

type HistorySummary = {
  resultDigest: string
  rowCount: number
  mappedRows: number
  unmappedRows: number
  pageCount: number
  queryExecutionCount: number
  captureBasis?: "capture_derived_v1"
  artifactSha256?: string
  derivedSubsetDigest?: string
  pageCountKind?: "virtual_validation"
  navigationCoverage: NonNullable<
    HistoricalSnapshot["provenance"]["navigationCoverage"]
  >
}
type Checkpoint = {
  stage: "summary" | "plan" | "discovery" | "candidate" | "done"
  cursor: {
    sourceAfterChunkId?: string
    catalogIndex?: number
    candidateIndex?: number
    candidateAfterChunkId?: string
  }
  sourceSummaryEnglish?: string
  candidateIds?: string[]
  analyticsCandidateIds?: string[]
  bestJudgment?: Omit<Judgment, "addedViewingValueEnglish"> & {
    targetVideoId: string
    addedViewingValueEnglish?: string
  }
  repair?: {
    candidateId: string
    afterChunkId: string | null
    attempts: number
    feedback: CandidateValidationFeedback
  }
  planRepair?: {
    catalogIndex: number
    attempts: number
    feedback: PlanValidationFeedback
  }
  historySummary?: HistorySummary
}
type Dependencies = {
  catalog: SourceCatalog
  ingest: SourceIngest
  model: StructuredModel
  history: HistoricalAnalyticsReader
  gaTransport: {
    fetchImpl: typeof fetch
    serviceAccountEmail: string
    tokenProvider?: () => Promise<
      { ok: true; accessToken: string } | { ok: false }
    >
  }
  gaCaptureTransport: GaCaptureTransport
  gaCaptureDirectory: string
}
type Context = {
  input: CatalogGenerationInput
  generationInputDigest: string
  catalog: SourceCatalog
  ingest: SourceIngest
  model: StructuredModel
  videos: Video[]
  candidateIdsBySource: Map<string, string[]>
  history?: HistoricalAnalyticsReader
  historyDefinition?: Awaited<ReturnType<typeof readHistoricalDefinition>>
  qualificationDigest?: string
  assertExternalAdmission: () => void
}
const nonnegative = z.number().int().nonnegative().safe()
const stateSchema = z.object({
  state: z.enum([
    "incomplete",
    "complete",
    "failed",
    "cancelled",
    "capacity_blocked",
  ]),
})
const bestJudgmentSchema = judgmentSchema.shape.connections.element.extend({
  targetVideoId: id,
  // Checkpoints and Admin ingest retain the old absent-field contract. The
  // provider's strict schema uses null for the same missing explanation.
  addedViewingValueEnglish:
    judgmentSchema.shape.connections.element.shape.addedViewingValueEnglish
      .unwrap()
      .optional(),
})
const repairFeedbackSchema = z.discriminatedUnion("reason", [
  z.object({
    reason: z.literal("metadata_field_unavailable"),
    field: z.enum(["title", "description", "keywords", "bibleCitations"]),
  }),
  z.object({ reason: z.literal("transcript_chunk_unavailable"), chunkId: id }),
  z.object({
    reason: z.literal("transcript_excerpt_not_verbatim"),
    chunkId: id,
  }),
  z.object({ reason: z.enum(["schema_invalid", "provider_output_invalid"]) }),
])
const planFeedbackSchema = z
  .object({
    reason: z.enum([
      "schema_invalid",
      "provider_output_invalid",
      "plan_source_id",
      "plan_duplicate_ids",
      "plan_outside_page",
    ]),
  })
  .strict()
const checkpointSchema: z.ZodType<Checkpoint> = z.object({
  stage: z.enum(["summary", "plan", "discovery", "candidate", "done"]),
  cursor: z.object({
    sourceAfterChunkId: id.optional(),
    catalogIndex: nonnegative.optional(),
    candidateIndex: nonnegative.optional(),
    candidateAfterChunkId: id.optional(),
  }),
  sourceSummaryEnglish: z.string().max(5_000).optional(),
  candidateIds: z.array(id).max(40).optional(),
  analyticsCandidateIds: z.array(id).max(40).optional(),
  bestJudgment: bestJudgmentSchema.optional(),
  repair: z
    .object({
      candidateId: id,
      afterChunkId: id.nullable(),
      attempts: nonnegative.min(1).max(MAX_CANDIDATE_JUDGMENT_ATTEMPTS),
      feedback: repairFeedbackSchema,
    })
    .optional(),
  planRepair: z
    .object({
      catalogIndex: nonnegative,
      attempts: nonnegative.min(1).max(MAX_ANALYTICS_PLAN_ATTEMPTS),
      feedback: planFeedbackSchema,
    })
    .optional(),
  historySummary: z
    .object({
      resultDigest: z.string().regex(/^[a-f0-9]{64}$/u),
      rowCount: nonnegative,
      mappedRows: nonnegative,
      unmappedRows: nonnegative,
      pageCount: nonnegative,
      queryExecutionCount: nonnegative,
      captureBasis: z.literal("capture_derived_v1").optional(),
      artifactSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .optional(),
      derivedSubsetDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .optional(),
      pageCountKind: z.literal("virtual_validation").optional(),
      navigationCoverage: z.object({
        candidateEvents: nonnegative,
        qualifiedEvents: nonnegative,
        homeEvents: nonnegative,
        selfEvents: nonnegative,
        crossHostEvents: nonnegative,
        malformedEvents: nonnegative,
        unmappedEvents: nonnegative,
        ambiguousEvents: nonnegative,
      }),
    })
    .optional(),
})
const claimSchema = z.object({
  sourceState: z.enum([
    "pending",
    "claimed",
    "complete_edges",
    "complete_empty",
    "failed",
  ]),
  leaseToken: z.uuid().nullable(),
  checkpointRevision: nonnegative.optional(),
  checkpoint: checkpointSchema.nullable().optional(),
})
const checkpointResponseSchema = z.object({
  checkpointRevision: nonnegative,
})
const modelReceiptSchema = checkpointResponseSchema.extend({
  receiptStored: z.literal(true),
  checkpointApplied: z.boolean(),
  staleLease: z.boolean(),
})
const callReservationSchema = z.object({
  state: z.literal("pending"),
  callId: id,
})
const historyReceiptSchema = z.object({ receiptStored: z.literal(true) })
const heartbeatSchema = z.object({ sourceState: z.literal("claimed") })
const manifestSchema = stateSchema.extend({ pendingSourceCount: nonnegative })
const probeSchema = z.object({
  observedDbBytes: nonnegative,
  clusterSystemId: z.string().regex(/^\d{1,20}$/u),
  availableBytes: z.null(),
})
const sourceResponseSchema = z.object({
  sourceState: z.enum(["complete_edges", "complete_empty"]),
})
const qualificationResponseSchema = z.object({
  qualificationDigest: z.string().regex(/^[a-f0-9]{64}$/u),
})
const captureStatusSchema = z.object({
  generationProtocolVersion: z.literal(3),
  inputSnapshotMode: z.literal("ga_aggregate_capture_v1"),
  capacityFresh: z.boolean(),
  historicalQualification: z.unknown().nullish(),
  historicalQualificationDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullish(),
  historyCallCounts: z.object({
    pending: nonnegative,
    succeeded: nonnegative,
    failed: nonnegative,
  }),
  pendingHistoryCalls: z
    .array(
      z.object({
        callId: id,
        startedAt: z.string().datetime(),
        reservedAt: z.string().datetime(),
      }),
    )
    .max(100)
    .optional(),
})

type CatalogBuildFailureCode =
  | "admin_contract_rejected"
  | "stale_source_claim"
  | "provider_invalid_output"
  | "provider_unavailable"
  | "provider_access_unavailable"
  | "analytics_incomplete"
  | "admission_stopped"
  | "input_stale"
  | "internal_failure"

class CatalogBuildError extends Error {
  constructor(
    readonly code: CatalogBuildFailureCode,
    readonly feedback?: ModelValidationFeedback,
  ) {
    super(code)
  }
}

type CandidateValidationFeedback =
  | EvidenceValidationFeedback
  | { reason: "schema_invalid" | "provider_output_invalid" }
type PlanValidationFeedback = z.output<typeof planFeedbackSchema>
type ModelValidationFeedback =
  | CandidateValidationFeedback
  | PlanValidationFeedback

function candidateFeedback(
  feedback: ModelValidationFeedback | undefined,
): CandidateValidationFeedback {
  const checked = repairFeedbackSchema.safeParse(feedback)
  return checked.success ? checked.data : { reason: "provider_output_invalid" }
}

function planFeedback(
  feedback: ModelValidationFeedback | undefined,
): PlanValidationFeedback {
  const checked = planFeedbackSchema.safeParse(feedback)
  return checked.success ? checked.data : { reason: "provider_output_invalid" }
}

function parsed<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const checked = schema.safeParse(value)
  if (!checked.success) throw new CatalogBuildError("admin_contract_rejected")
  return checked.data
}

function assertCaptureRefMatchesHeader(
  ref: GaCaptureSnapshotRef,
  header: GaCaptureHeader,
  headerSha256: string,
): void {
  const fields = [
    "version",
    "generationId",
    "generationInputDigest",
    "sourceSetDigest",
    "inputCutoff",
    "selectedCorpusDigest",
    "candidatePoolDigest",
    "routeMappingDigest",
    "querySpecDigest",
    "sourcePatternTableDigest",
    "baseQualificationDigest",
    "propertyId",
    "propertyTimeZone",
    "requestedStart",
    "requestedEnd",
    "usableStart",
    "usableEnd",
    "sourceAvailability",
    "captureStartedAt",
    "captureCompletedAt",
    "verification",
    "startRows",
    "referrerRows",
    "startPages",
    "referrerPages",
    "physicalHttpAttempts",
    "physicalSucceededCalls",
  ] as const
  if (
    ref.headerSha256 !== headerSha256 ||
    fields.some(
      (field) =>
        gaCaptureCanonicalJson(ref[field]) !==
        gaCaptureCanonicalJson(header[field]),
    )
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
}

function isLiveClaimConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Source has a live claim" &&
    "code" in error &&
    error.code === "conflict"
  )
}

function sanitizeUsage(usage: unknown): ModelUsage {
  if (typeof usage !== "object" || usage === null) return {}
  const data = usage as Record<string, unknown>
  const token = (value: unknown) =>
    Number.isSafeInteger(value) && Number(value) >= 0
      ? Number(value)
      : undefined
  return {
    inputTokens: token(data.inputTokens),
    outputTokens: token(data.outputTokens),
    cachedInputTokens: token(data.cachedInputTokens),
    costUsd:
      typeof data.costUsd === "number" &&
      Number.isFinite(data.costUsd) &&
      data.costUsd >= 0
        ? data.costUsd
        : undefined,
  }
}

function usageFromError(error: unknown): ModelUsage {
  return typeof error === "object" && error !== null && "usage" in error
    ? sanitizeUsage(error.usage)
    : {}
}

function sumHistory(
  prior: HistorySummary | undefined,
  snapshot: HistoricalSnapshot,
): HistorySummary {
  const p = snapshot.provenance
  const observed = p.navigationCoverage
  if (!observed) throw new HistoricalAnalyticsError("analytics_incomplete")
  const previous = prior?.navigationCoverage
  if (
    (prior?.artifactSha256 && prior.artifactSha256 !== p.artifactSha256) ||
    (p.captureMode === "capture_derived_v1" &&
      (!p.artifactSha256 ||
        !p.derivedSubsetDigest ||
        p.queryExecutionCount !== 0 ||
        p.pageCountKind !== "virtual_validation"))
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  return {
    resultDigest: digest([prior?.resultDigest ?? null, p.resultDigest]),
    rowCount: (prior?.rowCount ?? 0) + p.rowCount,
    mappedRows: (prior?.mappedRows ?? 0) + p.mappedRows,
    unmappedRows: (prior?.unmappedRows ?? 0) + p.unmappedRows,
    pageCount: (prior?.pageCount ?? 0) + p.pageCount,
    queryExecutionCount:
      (prior?.queryExecutionCount ?? 0) + p.queryExecutionCount,
    ...(p.captureMode === "capture_derived_v1"
      ? {
          captureBasis: "capture_derived_v1" as const,
          artifactSha256: p.artifactSha256!,
          pageCountKind: "virtual_validation" as const,
          derivedSubsetDigest: gaCaptureDigest({
            version: "ga_watch_source_subsets_v1",
            previous: prior?.derivedSubsetDigest ?? null,
            subset: p.derivedSubsetDigest,
          }),
        }
      : {}),
    navigationCoverage: {
      candidateEvents:
        (previous?.candidateEvents ?? 0) + observed.candidateEvents,
      qualifiedEvents:
        (previous?.qualifiedEvents ?? 0) + observed.qualifiedEvents,
      homeEvents: (previous?.homeEvents ?? 0) + observed.homeEvents,
      selfEvents: (previous?.selfEvents ?? 0) + observed.selfEvents,
      crossHostEvents:
        (previous?.crossHostEvents ?? 0) + observed.crossHostEvents,
      malformedEvents:
        (previous?.malformedEvents ?? 0) + observed.malformedEvents,
      unmappedEvents: (previous?.unmappedEvents ?? 0) + observed.unmappedEvents,
      ambiguousEvents:
        (previous?.ambiguousEvents ?? 0) + observed.ambiguousEvents,
    },
  }
}

async function processSource(
  context: Context,
  source: Video,
  leaseToken: string,
  saved: Checkpoint | null,
  savedRevision: number,
): Promise<void> {
  const {
    input,
    generationInputDigest,
    ingest,
    catalog,
    videos,
    candidateIdsBySource,
    model,
    history,
    historyDefinition,
    qualificationDigest,
    assertExternalAdmission,
  } = context
  const byId = new Map(videos.map((video) => [video.id, video]))
  const candidateIds = candidateIdsBySource.get(source.id)
  if (!candidateIds) throw new CatalogBuildError("input_stale")
  const candidates = candidateIds.map((id) => {
    const video = byId.get(id)
    if (!video) throw new CatalogBuildError("input_stale")
    return video
  })
  const identity = {
    generationId: input.generationId,
    generationInputDigest,
    sourceVideoId: source.id,
    leaseToken,
  }
  let revision = savedRevision
  let checkpoint: Checkpoint = saved ?? {
    stage: "summary",
    cursor: {},
    sourceSummaryEnglish: source.description || source.title,
  }
  const heartbeat = async () =>
    parsed(heartbeatSchema, await ingest({ action: "heartbeat", ...identity }))
  async function advance(next: Checkpoint) {
    const response = parsed(
      checkpointResponseSchema,
      await ingest({
        action: "checkpoint",
        ...identity,
        expectedRevision: revision,
        checkpointId: randomUUID(),
        checkpoint: next,
      }),
    )
    revision = response.checkpointRevision
    checkpoint = next
  }
  async function call<T extends z.ZodType>(
    stage:
      | "source_summary"
      | "analytics_query_plan"
      | "catalog_discovery"
      | "candidate_judgment",
    schema: T,
    data: unknown,
    maxOutputTokens: number,
    next: (output: z.output<T>) => Checkpoint,
    choice?: (output: z.output<T>) => Record<string, unknown> | undefined,
    validate?: (output: z.output<T>) => void,
    onInvalidOutput?: (feedback: ModelValidationFeedback) => Checkpoint,
  ) {
    const system = input.historyRequired ? HISTORY_SYSTEM : CONTENT_SYSTEM
    const prompt = JSON.stringify({ task: stage, untrustedCatalogData: data })
    const inputDigest = digest({ system, prompt })
    const callId = randomUUID()
    const startedAt = new Date().toISOString()
    await heartbeat()
    assertExternalAdmission()
    const reservation = parsed(
      callReservationSchema,
      await ingest({
        action: "model_call_start",
        ...identity,
        callId,
        stage,
        modelId: PRECOMPUTED_MODEL_ID,
        inputDigest,
        startedAt,
      }),
    )
    if (reservation.callId !== callId)
      throw new CatalogBuildError("admin_contract_rejected")
    let output: z.output<T> | undefined
    let usage: ModelUsage = {}
    let failureCode: CatalogBuildFailureCode | undefined
    let validationFeedback: ModelValidationFeedback | undefined
    try {
      const response = await model.generate({
        schema,
        system,
        prompt,
        maxOutputTokens,
      })
      usage = sanitizeUsage(response.usage)
      output = schema.parse(response.output)
      validate?.(output)
    } catch (error) {
      usage = { ...usageFromError(error), ...usage }
      validationFeedback =
        (error instanceof CatalogBuildError ? error.feedback : undefined) ??
        evidenceValidationFeedback(error) ??
        (error instanceof z.ZodError
          ? { reason: "schema_invalid" }
          : error instanceof Error &&
              error.message === "provider_invalid_output"
            ? { reason: "provider_output_invalid" }
            : undefined)
      failureCode =
        error instanceof z.ZodError ||
        (error instanceof Error && error.message === "provider_invalid_output")
          ? "provider_invalid_output"
          : isAstraAccessFailure(error)
            ? "provider_access_unavailable"
            : "provider_unavailable"
    }
    let nextCheckpoint = checkpoint
    let selectedChoice: Record<string, unknown> | undefined
    if (!failureCode) {
      try {
        nextCheckpoint = next(output!)
        selectedChoice = choice?.(output!)
      } catch {
        // A charged response still gets its usage receipt even if a local
        // projection fails before the checkpoint can advance.
        failureCode = "internal_failure"
        nextCheckpoint = checkpoint
        selectedChoice = undefined
      }
    } else if (failureCode === "provider_invalid_output" && onInvalidOutput) {
      try {
        nextCheckpoint = onInvalidOutput(
          validationFeedback ?? { reason: "provider_output_invalid" },
        )
      } catch {
        failureCode = "internal_failure"
        nextCheckpoint = checkpoint
      }
    }
    const receipt = parsed(
      modelReceiptSchema,
      await ingest({
        action: "model_call",
        ...identity,
        callId,
        stage,
        status: failureCode ? "failed" : "succeeded",
        modelId: PRECOMPUTED_MODEL_ID,
        inputDigest,
        ...(failureCode
          ? { errorCode: failureCode }
          : { outputDigest: digest(output) }),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        costUsd: usage.costUsd,
        startedAt,
        finishedAt: new Date().toISOString(),
        expectedRevision: revision,
        checkpointId: randomUUID(),
        checkpoint: nextCheckpoint,
        ...(selectedChoice ? { choice: selectedChoice } : {}),
      }),
    )
    if (!receipt.checkpointApplied || receipt.staleLease)
      throw new CatalogBuildError("stale_source_claim")
    revision = receipt.checkpointRevision
    checkpoint = nextCheckpoint
    if (failureCode)
      throw new CatalogBuildError(failureCode, validationFeedback)
  }

  let sourceHistory: HistoricalSnapshot | undefined
  if (history && historyDefinition && checkpoint.stage !== "done") {
    await heartbeat()
    sourceHistory = await readHistoricalSnapshot({
      reader: history,
      definition: historyDefinition,
      catalog: [source],
      routeCatalog: videos,
      sourceVideoId: source.id,
      selectedVideoIds: [],
      includeSourceEngagement: true,
      cutoff: input.inputCutoff,
    })
    if (!checkpoint.historySummary)
      await advance({
        ...checkpoint,
        historySummary: sumHistory(undefined, sourceHistory),
      })
  }

  const pageHistoryCache = new Map<number, HistoricalSnapshot>()
  while (checkpoint.stage !== "done") {
    if (checkpoint.stage === "summary") {
      const page = await catalog.chunks({
        videoId: source.id,
        cutoff: input.inputCutoff,
        afterChunkId: checkpoint.cursor.sourceAfterChunkId,
      })
      const nextCheckpoint: Checkpoint = {
        ...checkpoint,
        stage: page.nextCursor
          ? "summary"
          : historyDefinition
            ? "plan"
            : "discovery",
        cursor: page.nextCursor
          ? { sourceAfterChunkId: page.nextCursor }
          : { catalogIndex: 0 },
      }
      if (page.chunks.length === 0) {
        await advance(nextCheckpoint)
      } else {
        await call(
          "source_summary",
          summarySchema,
          {
            source: modelVideo(source),
            previousSummaryEnglish: checkpoint.sourceSummaryEnglish,
            chunks: page.chunks,
            historicalDefinitions: sourceHistory?.definitionsForModel,
            historicalSourceSignal: sourceHistory?.signal(source.id),
            instruction:
              "Update the English summary with all new themes and useful connections; use every language supplied.",
          },
          2_048,
          (output) => ({
            ...nextCheckpoint,
            sourceSummaryEnglish: output.summaryEnglish,
          }),
        )
      }
      continue
    }
    const catalogIndex = checkpoint.cursor.catalogIndex ?? 0
    if (catalogIndex >= candidates.length) {
      await advance({ ...checkpoint, stage: "done", cursor: {} })
      continue
    }
    const page = candidates.slice(catalogIndex, catalogIndex + 40)
    if (checkpoint.stage === "plan") {
      if (!historyDefinition)
        throw new CatalogBuildError("analytics_incomplete")
      const savedPlanRepair = checkpoint.planRepair
      if (savedPlanRepair && savedPlanRepair.catalogIndex !== catalogIndex)
        throw new CatalogBuildError("admin_contract_rejected")
      if ((savedPlanRepair?.attempts ?? 0) >= MAX_ANALYTICS_PLAN_ATTEMPTS)
        throw new CatalogBuildError(
          "provider_invalid_output",
          savedPlanRepair?.feedback,
        )
      let retryFeedback = savedPlanRepair?.feedback
      for (
        let attempt = savedPlanRepair?.attempts ?? 0;
        attempt < MAX_ANALYTICS_PLAN_ATTEMPTS;
        attempt += 1
      ) {
        try {
          await call(
            "analytics_query_plan",
            analyticsQueryPlanSchema,
            {
              historicalDefinitions: sourceHistory?.definitionsForModel,
              source: modelVideo(source),
              candidates: page.map(modelVideo),
              ...(retryFeedback ? { validationFeedback: retryFeedback } : {}),
              instruction:
                attempt === 1
                  ? "Correct the rejected Video ID selection. Return unique IDs from this candidate page only, never the source. Keep useful historical inspection candidates; an empty selection is valid when none qualify."
                  : "Select Video IDs in this page whose Watch starts and source-to-candidate referrer navigation you want to inspect. Navigation is not consecutive playback. Missing exposure is unknown, not negative evidence. Select only page Video IDs.",
            },
            2_048,
            (output) => ({
              stage: "discovery",
              cursor: checkpoint.cursor,
              sourceSummaryEnglish: checkpoint.sourceSummaryEnglish,
              analyticsCandidateIds: output.candidateVideoIds,
              historySummary: checkpoint.historySummary,
            }),
            undefined,
            (output) => {
              const ids = new Set(page.map((video) => video.id))
              if (output.candidateVideoIds.includes(source.id))
                throw new CatalogBuildError("provider_invalid_output", {
                  reason: "plan_source_id",
                })
              if (
                new Set(output.candidateVideoIds).size !==
                output.candidateVideoIds.length
              )
                throw new CatalogBuildError("provider_invalid_output", {
                  reason: "plan_duplicate_ids",
                })
              if (output.candidateVideoIds.some((videoId) => !ids.has(videoId)))
                throw new CatalogBuildError("provider_invalid_output", {
                  reason: "plan_outside_page",
                })
            },
            (feedback) => ({
              ...checkpoint,
              planRepair: {
                catalogIndex,
                attempts: attempt + 1,
                feedback: planFeedback(feedback),
              },
            }),
          )
          break
        } catch (error) {
          if (
            error instanceof CatalogBuildError &&
            error.code === "provider_invalid_output"
          ) {
            retryFeedback = planFeedback(error.feedback)
            console.warn(
              JSON.stringify({
                event: "precomputed_analytics_plan_rejected",
                sourceVideoId: source.id,
                catalogIndex,
                attempt: attempt + 1,
                feedback: retryFeedback,
              }),
            )
            if (attempt + 1 < MAX_ANALYTICS_PLAN_ATTEMPTS) continue
          }
          throw error
        }
      }
      continue
    }
    let pageHistory = pageHistoryCache.get(catalogIndex)
    if (history && historyDefinition) {
      if (!checkpoint.analyticsCandidateIds)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      if (!pageHistory) {
        await heartbeat()
        pageHistory = await readHistoricalSnapshot({
          reader: history,
          definition: historyDefinition,
          catalog: [source, ...page.filter((video) => video.id !== source.id)],
          routeCatalog: videos,
          sourceVideoId: source.id,
          selectedVideoIds: checkpoint.analyticsCandidateIds,
          includeSourceEngagement: false,
          cutoff: input.inputCutoff,
        })
        pageHistoryCache.set(catalogIndex, pageHistory)
      }
    }
    if (checkpoint.stage === "discovery") {
      await call(
        "catalog_discovery",
        discoverySchema,
        {
          source: modelVideo(source),
          sourceSummaryEnglish: checkpoint.sourceSummaryEnglish,
          candidates: page.map(modelVideo),
          historicalDefinitions: pageHistory?.definitionsForModel,
          historicalSignals: pageHistory
            ? page.map((video) => ({
                videoId: video.id,
                engagement:
                  video.id === source.id
                    ? sourceHistory?.signal(source.id)
                    : pageHistory?.signal(video.id),
                navigationFromSource:
                  pageHistory?.navigation?.(source.id, video.id) ?? null,
              }))
            : undefined,
          instruction:
            "Return every candidate with a plausible explainable connection; exclude the source and duplicate editions/dubs. Do not impose a fixed number.",
        },
        4_096,
        (output) => ({
          stage: "candidate",
          cursor: { catalogIndex, candidateIndex: 0 },
          sourceSummaryEnglish: checkpoint.sourceSummaryEnglish,
          candidateIds: output.candidateVideoIds,
          analyticsCandidateIds: checkpoint.analyticsCandidateIds,
          historySummary: pageHistory
            ? sumHistory(checkpoint.historySummary, pageHistory)
            : checkpoint.historySummary,
        }),
        undefined,
        (output) => {
          const ids = new Set(page.map((video) => video.id))
          if (
            new Set(output.candidateVideoIds).size !==
              output.candidateVideoIds.length ||
            output.candidateVideoIds.some(
              (videoId) =>
                videoId === source.id ||
                !ids.has(videoId) ||
                page.find((video) => video.id === videoId)?.coreId ===
                  source.coreId,
            )
          )
            throw new CatalogBuildError("provider_invalid_output")
        },
      )
      continue
    }
    const candidateIndex = checkpoint.cursor.candidateIndex ?? 0
    const candidateId = checkpoint.candidateIds?.[candidateIndex]
    if (!candidateId) {
      if (checkpoint.repair)
        throw new CatalogBuildError("admin_contract_rejected")
      await advance({
        stage: historyDefinition ? "plan" : "discovery",
        cursor: { catalogIndex: catalogIndex + 40 },
        sourceSummaryEnglish: checkpoint.sourceSummaryEnglish,
        historySummary: checkpoint.historySummary,
      })
      continue
    }
    const candidate = page.find((video) => video.id === candidateId)
    if (!candidate) throw new CatalogBuildError("input_stale")
    const chunks = await catalog.chunks({
      videoId: candidate.id,
      cutoff: input.inputCutoff,
      afterChunkId: checkpoint.cursor.candidateAfterChunkId,
    })
    const last = !chunks.nextCursor
    const nextCandidate = (best: Checkpoint["bestJudgment"]): Checkpoint => ({
      stage: "candidate",
      cursor: last
        ? { catalogIndex, candidateIndex: candidateIndex + 1 }
        : {
            catalogIndex,
            candidateIndex,
            candidateAfterChunkId: chunks.nextCursor!,
          },
      sourceSummaryEnglish: checkpoint.sourceSummaryEnglish,
      candidateIds: checkpoint.candidateIds,
      analyticsCandidateIds: checkpoint.analyticsCandidateIds,
      bestJudgment: last ? undefined : best,
      historySummary: checkpoint.historySummary,
    })
    if (chunks.chunks.length === 0 && !last) {
      await advance(nextCandidate(checkpoint.bestJudgment))
      continue
    }
    const bestOf = (output: z.output<typeof judgmentSchema>) => {
      const found = output.connections[0]
      return found &&
        (!checkpoint.bestJudgment ||
          found.strength > checkpoint.bestJudgment.strength)
        ? {
            ...found,
            targetVideoId: candidate.id,
            addedViewingValueEnglish:
              found.addedViewingValueEnglish ?? undefined,
          }
        : checkpoint.bestJudgment
    }
    const savedRepair = checkpoint.repair
    if (
      savedRepair &&
      (savedRepair.candidateId !== candidate.id ||
        savedRepair.afterChunkId !==
          (checkpoint.cursor.candidateAfterChunkId ?? null))
    )
      throw new CatalogBuildError("admin_contract_rejected")
    if ((savedRepair?.attempts ?? 0) >= MAX_CANDIDATE_JUDGMENT_ATTEMPTS)
      throw new CatalogBuildError(
        "provider_invalid_output",
        savedRepair?.feedback,
      )
    let retryFeedback: CandidateValidationFeedback | undefined =
      savedRepair?.feedback
    const spanOffer = buildTranscriptSpanOffer(chunks.chunks, {
      generationInputDigest,
      inputCutoff: input.inputCutoff,
      sourceVideoId: source.id,
      candidateVideoId: candidate.id,
      catalogIndex,
      candidateIndex,
      afterChunkId: checkpoint.cursor.candidateAfterChunkId ?? null,
    })
    for (
      let attempt = savedRepair?.attempts ?? 0;
      attempt < MAX_CANDIDATE_JUDGMENT_ATTEMPTS;
      attempt += 1
    ) {
      try {
        let resolvedJudgment: z.output<typeof judgmentSchema> | undefined
        const resolved = (output: z.output<typeof spanJudgmentSchema>) => {
          if (!resolvedJudgment) {
            const materialized = materializeSpanJudgment(output, spanOffer)
            if (!materialized)
              throw new CatalogBuildError("provider_invalid_output")
            resolvedJudgment = materialized
          }
          return resolvedJudgment
        }
        await call(
          "candidate_judgment",
          spanJudgmentSchema,
          {
            source: modelVideo(source),
            sourceSummaryEnglish: checkpoint.sourceSummaryEnglish,
            candidate: modelVideo(candidate),
            transcriptChunks: spanOffer.promptChunks,
            historicalDefinitions: pageHistory?.definitionsForModel,
            historicalSourceSignal: sourceHistory?.signal(source.id),
            historicalCandidateSignal: pageHistory?.signal(candidate.id),
            historicalNavigation:
              pageHistory?.navigation?.(source.id, candidate.id) ?? null,
            ...(retryFeedback ? { validationFeedback: retryFeedback } : {}),
            instruction:
              attempt === 1
                ? "Retry with verified evidence only. Choose transcript support only by a span ID offered in this candidate's current transcript page; never write an excerpt or choose a foreign ID. Metadata fields must be present on this candidate. If you cannot support a connection, return an empty connections array."
                : chunks.chunks.length === 0
                  ? "Return zero or one connection. Only metadata evidence is available; do not invent transcript support."
                  : "Return zero or one connection. For transcript evidence, select one to three offered span IDs from this candidate's current transcript page; the server will copy their exact text. Do not write excerpts. Explain the connection in English. For parent/chapter links, explain added viewing value.",
          },
          2_048,
          (output) => nextCandidate(bestOf(resolved(output))),
          last
            ? (output) => {
                const best = bestOf(resolved(output))
                return best
                  ? {
                      targetVideoId: candidate.id,
                      kind: best.kind,
                      strength: best.strength,
                      relationship: best.relationship,
                      reasonEnglish: best.reasonEnglish,
                      addedViewingValueEnglish:
                        best.addedViewingValueEnglish ?? undefined,
                      evidence: best.evidence,
                    }
                  : undefined
              }
            : undefined,
          (output) =>
            resolved(output).connections.forEach((connection) =>
              assertEvidence(connection, chunks.chunks, candidate),
            ),
          (feedback) => ({
            ...checkpoint,
            repair: {
              candidateId: candidate.id,
              afterChunkId: checkpoint.cursor.candidateAfterChunkId ?? null,
              attempts: attempt + 1,
              feedback: candidateFeedback(feedback),
            },
          }),
        )
        break
      } catch (error) {
        if (
          error instanceof CatalogBuildError &&
          error.code === "provider_invalid_output"
        ) {
          retryFeedback = candidateFeedback(error.feedback)
          console.warn(
            JSON.stringify({
              event: "precomputed_candidate_evidence_rejected",
              sourceVideoId: source.id,
              candidateVideoId: candidate.id,
              attempt: attempt + 1,
              feedback: retryFeedback,
            }),
          )
          if (attempt + 1 < MAX_CANDIDATE_JUDGMENT_ATTEMPTS) continue
        }
        throw error
      }
    }
  }
  if (historyDefinition?.provider === "ga_data_api") {
    if (!checkpoint.historySummary || !qualificationDigest)
      throw new HistoricalAnalyticsError("analytics_incomplete")
    parsed(
      z.object({ replay: z.boolean() }),
      await ingest({
        action: "source_history",
        ...identity,
        history: {
          evidenceKind: "referrer_navigation_v1",
          sourceResource: `properties/${GA_WATCH_PROPERTY.id}`,
          queryId: historyDefinition.queryId,
          rangeStart: historyDefinition.rangeStart,
          rangeEnd: historyDefinition.rangeEnd,
          qualificationDigest,
          ...checkpoint.historySummary,
          status: "complete",
        },
      }),
    )
  }
  parsed(sourceResponseSchema, await ingest({ action: "source", ...identity }))
}

/** One reservation per actual GA HTTP attempt, including transport retries. */
export async function recordHistoryAttempt(input: {
  ingest: SourceIngest
  generationId: string
  generationInputDigest: string
  sourceVideoId?: string
  leaseToken?: string
  stage: "qualification" | "snapshot_page" | "retry"
  requestDigest: string
  url: RequestInfo | URL
  init?: RequestInit
  fetchImpl?: typeof fetch
}): Promise<Response> {
  const callId = randomUUID()
  const common = {
    generationId: input.generationId,
    generationInputDigest: input.generationInputDigest,
    ...(input.sourceVideoId
      ? { sourceVideoId: input.sourceVideoId, leaseToken: input.leaseToken }
      : {}),
    callId,
  }
  const startedAt = new Date().toISOString()
  if (input.sourceVideoId) {
    if (!input.leaseToken)
      throw new CatalogBuildError("admin_contract_rejected")
    parsed(
      heartbeatSchema,
      await input.ingest({
        action: "heartbeat",
        generationId: input.generationId,
        generationInputDigest: input.generationInputDigest,
        sourceVideoId: input.sourceVideoId,
        leaseToken: input.leaseToken,
      }),
    )
  }
  const reservation = parsed(
    callReservationSchema,
    await input.ingest({
      action: "history_call_start",
      ...common,
      stage: input.stage,
      requestDigest: input.requestDigest,
      startedAt,
    }),
  )
  if (reservation.callId !== callId)
    throw new CatalogBuildError("admin_contract_rejected")
  let response: Response
  try {
    response = input.fetchImpl
      ? await input.fetchImpl(input.url, input.init)
      : await fetchGaPhysical(input.url, input.init)
  } catch (error) {
    const timedOut =
      input.init?.signal?.aborted === true &&
      input.init.signal.reason === error &&
      error instanceof DOMException &&
      error.name === "TimeoutError"
    parsed(
      historyReceiptSchema,
      await input.ingest({
        action: "history_call",
        ...common,
        status: "failed",
        errorCode: timedOut ? "ga_timeout" : "analytics_unavailable",
        finishedAt: new Date().toISOString(),
      }),
    )
    settleGaPhysicalFailure(error, input.init?.signal)
    throw error
  }
  parsed(
    historyReceiptSchema,
    await input.ingest({
      action: "history_call",
      ...common,
      status: response.ok ? "succeeded" : "failed",
      ...(response.ok
        ? {}
        : {
            errorCode:
              Number.isInteger(response.status) &&
              response.status >= 100 &&
              response.status <= 599
                ? `ga_http_${response.status}`
                : "analytics_unavailable",
          }),
      finishedAt: new Date().toISOString(),
    }),
  )
  return response
}

export async function runPrecomputedCatalog(
  raw: z.input<typeof CatalogGenerationInputSchema>,
  provided: Partial<Dependencies> = {},
): Promise<{
  state: "complete" | "incomplete" | "failed" | "replayed"
  generationId: string
  completedSourceCount: number
  failedSourceCount: number
}> {
  const input = CatalogGenerationInputSchema.parse(raw)
  if (input.snapshotMode && (!input.historyRequired || provided.history))
    throw new HistoricalAnalyticsError("analytics_unavailable")
  if (
    input.historyRequired &&
    provided.history &&
    provided.history.evidenceKind !== "referrer_navigation_v1"
  )
    throw new HistoricalAnalyticsError("analytics_unavailable")
  const defaults =
    provided.catalog && provided.ingest
      ? null
      : createAdminSourceDependencies(input.inputCutoff)
  const catalog = provided.catalog ?? defaults!.catalog
  const ingest = provided.ingest ?? defaults!.ingest
  const videos: Video[] = []
  for await (const page of pages(catalog, input.inputCutoff))
    videos.push(...page)
  // Admin validates sourceSetDigest using JavaScript's default code-unit sort.
  videos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const sourceVideoIds = videos.map((video) => video.id)
  const retrieval = await buildCandidateRetrieval(
    catalog,
    videos,
    input.inputCutoff,
  )
  const promptVersion = input.historyRequired
    ? input.snapshotMode
      ? CAPTURE_HISTORY_PROMPT_VERSION
      : HISTORY_PROMPT_VERSION
    : CONTENT_PROMPT_VERSION
  const sourceSetDigest = digest(sourceVideoIds)
  const generationInputDigest = digest({
    cutoff: input.inputCutoff,
    historyRequired: input.historyRequired,
    videos,
    candidateRetrievalRevision: CANDIDATE_RETRIEVAL_REVISION,
    selectedCorpusDigest: retrieval.selectedCorpusDigest,
    candidatePoolDigest: retrieval.candidatePoolDigest,
    promptVersion,
    ...(input.snapshotMode ? { snapshotMode: input.snapshotMode } : {}),
  })
  const inputMode = input.historyRequired
    ? "historical_analytics"
    : "content_only"
  const started = parsed(
    stateSchema,
    await ingest({
      action: "start",
      protocolVersion: input.snapshotMode ? 3 : 2,
      generationId: input.generationId,
      modelId: PRECOMPUTED_MODEL_ID,
      promptVersion,
      inputMode,
      inputSnapshotMode: input.snapshotMode ?? "observed_fenced",
      inputDigest: generationInputDigest,
      sourceSetDigest,
      inputCutoff: input.inputCutoff,
      expectedSourceCount: sourceVideoIds.length,
    }),
  )
  if (started.state === "complete")
    return {
      state: "replayed",
      generationId: input.generationId,
      completedSourceCount: sourceVideoIds.length,
      failedSourceCount: 0,
    }
  parsed(
    manifestSchema,
    await ingest({
      action: "manifest",
      generationId: input.generationId,
      generationInputDigest,
      sourceVideoIds,
    }),
  )
  parsed(
    probeSchema,
    await ingest({
      action: "capacity_probe",
      generationId: input.generationId,
      generationInputDigest,
    }),
  )
  const capacity = parsed(
    stateSchema,
    await ingest({
      action: "capacity",
      generationId: input.generationId,
      generationInputDigest,
      measurement: input.capacity,
    }),
  )
  if (capacity.state === "capacity_blocked")
    return {
      state: "failed",
      generationId: input.generationId,
      completedSourceCount: 0,
      failedSourceCount: 0,
    }
  let stopped = false
  const assertExternalAdmission = () => {
    if (stopped) throw new CatalogBuildError("admission_stopped")
  }
  let activeGaAttempts = 0
  const waitingGaAttempts: Array<{
    start: () => void
    reject: (error: Error) => void
  }> = []
  const stopAdmission = () => {
    stopped = true
    for (const waiting of waitingGaAttempts.splice(0))
      waiting.reject(new CatalogBuildError("admission_stopped"))
  }
  const withGaAdmission = async <T>(attempt: () => Promise<T>): Promise<T> => {
    assertExternalAdmission()
    if (activeGaAttempts >= 2)
      await new Promise<void>((resolve, reject) => {
        waitingGaAttempts.push({ start: resolve, reject })
      })
    else activeGaAttempts += 1
    try {
      assertExternalAdmission()
      return await attempt()
    } finally {
      activeGaAttempts -= 1
      const waiting = waitingGaAttempts.shift()
      if (waiting && !stopped) {
        activeGaAttempts += 1
        waiting.start()
      }
    }
  }
  const serviceAccountEmail =
    provided.gaTransport?.serviceAccountEmail ??
    env.PRECOMPUTED_GA4_SERVICE_ACCOUNT_EMAIL
  const createHistoryReader = (
    scope?: {
      sourceVideoId: string
      leaseToken: string
    },
    range?: { rangeStart: string; rangeEnd: string },
    globalStage: "qualification" | "snapshot_page" = "qualification",
  ) => {
    if (
      (env.PRECOMPUTED_GA4_PROPERTY_ID !== GA_WATCH_PROPERTY.id &&
        !provided.gaTransport) ||
      !serviceAccountEmail
    )
      return undefined
    let lastRequestDigest: string | undefined
    return createGaWatchHistoryReader({
      propertyId: GA_WATCH_PROPERTY.id,
      serviceAccountEmail,
      rangeStart: range?.rangeStart ?? GA_WATCH_PROPERTY.createdDate,
      rangeEnd: range?.rangeEnd ?? gaWatchClosedRangeEnd(input.inputCutoff),
      ...(provided.gaTransport?.tokenProvider
        ? { tokenProvider: provided.gaTransport.tokenProvider }
        : {}),
      fetchImpl: (url, init) => {
        const requestDigest = digest({ url: String(url), body: init?.body })
        const stage =
          requestDigest === lastRequestDigest
            ? "retry"
            : scope
              ? "snapshot_page"
              : globalStage
        lastRequestDigest = requestDigest
        return withGaAdmission(() =>
          recordHistoryAttempt({
            ingest,
            generationId: input.generationId,
            generationInputDigest,
            sourceVideoId: scope?.sourceVideoId,
            leaseToken: scope?.leaseToken,
            stage,
            requestDigest,
            url,
            init,
            fetchImpl: provided.gaTransport?.fetchImpl,
          }),
        )
      },
    })
  }
  let history: HistoricalAnalyticsReader | undefined
  let historyDefinition:
    | Awaited<ReturnType<typeof readHistoricalDefinition>>
    | undefined
  let qualificationDigest: string | undefined
  let sealedCaptureDirectory: string | undefined
  if (input.snapshotMode) {
    const routeCatalog = videos.filter(
      (video): video is Video & WatchRouteCatalogVideo =>
        video.watchRouteIdentity?.basis === "current_catalog_cutoff_fenced",
    )
    if (routeCatalog.length !== videos.length)
      throw new HistoricalAnalyticsError("analytics_mapping_unverified")
    const binding: GaWatchCaptureBinding = {
      generationId: input.generationId,
      generationInputDigest,
      sourceSetDigest,
      inputCutoff: input.inputCutoff,
      selectedCorpusDigest: retrieval.selectedCorpusDigest,
      candidatePoolDigest: retrieval.candidatePoolDigest,
      routeCatalog,
      propertyId: GA_WATCH_PROPERTY.id,
      requestedStart: GA_WATCH_PROPERTY.createdDate,
      requestedEnd: gaWatchClosedRangeEnd(input.inputCutoff),
    }
    const directoryRoot = provided.gaCaptureDirectory ?? env.MASTRA_STORAGE_DIR
    if (!directoryRoot)
      throw new HistoricalAnalyticsError("analytics_unavailable")
    const directory = join(
      directoryRoot,
      "precomputed-ga-capture",
      digest(input.generationId),
    )
    const transport =
      provided.gaCaptureTransport ?? createAdminGaCaptureTransport()
    const readCaptureStatus = async () =>
      parsed(
        captureStatusSchema,
        await ingest({
          action: "status",
          generationId: input.generationId,
          generationInputDigest,
        }),
      )
    let status = await readCaptureStatus()
    if (!status.historicalQualification) {
      for (let batch = 0; status.historyCallCounts.pending > 0; batch++) {
        if (batch >= 100 || !status.pendingHistoryCalls?.length)
          throw new HistoricalAnalyticsError("analytics_incomplete")
        const due = status.pendingHistoryCalls.filter(
          (call) => Date.now() - Date.parse(call.reservedAt) >= 30 * 60_000,
        )
        if (due.length !== status.pendingHistoryCalls.length)
          throw new HistoricalAnalyticsError("analytics_incomplete")
        for (const call of due)
          await ingest({
            action: "history_call_reconcile",
            generationId: input.generationId,
            generationInputDigest,
            callId: call.callId,
          })
        status = await readCaptureStatus()
      }
    }
    let ref: GaCaptureSnapshotRef
    let artifact: Awaited<ReturnType<typeof openGaWatchCaptureArtifact>>
    if (status.historicalQualification) {
      if (status.historyCallCounts.pending !== 0)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      const stored = status.historicalQualification
      if (
        typeof stored !== "object" ||
        stored === null ||
        !("snapshotRef" in stored) ||
        !status.historicalQualificationDigest
      )
        throw new HistoricalAnalyticsError("analytics_incomplete")
      ref = parseGaCaptureSnapshotRef(stored.snapshotRef)
      const path = await transport.download({
        generationId: input.generationId,
        generationInputDigest,
        artifactSha256: ref.artifactSha256,
        artifactBytes: ref.artifactBytes,
        directory,
      })
      artifact = await openGaWatchCaptureArtifact({
        path,
        expectedSha256: ref.artifactSha256,
        expectedBytes: ref.artifactBytes,
      })
      if (
        gaCaptureCanonicalJson(
          Object.fromEntries(
            Object.entries(stored).filter(([key]) => key !== "snapshotRef"),
          ),
        ) !== gaCaptureCanonicalJson(artifact.header.baseQualification)
      )
        throw new HistoricalAnalyticsError("analytics_incomplete")
      qualificationDigest = status.historicalQualificationDigest
    } else {
      if (status.historicalQualificationDigest)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      const sealed = await captureGaWatchAggregates({
        directory,
        binding,
        createReader: (rangeStart, rangeEnd, stage) => {
          const reader = createHistoryReader(
            undefined,
            { rangeStart, rangeEnd },
            stage,
          )
          if (!reader)
            throw new HistoricalAnalyticsError("analytics_unavailable")
          return reader
        },
        historyCallCounts: async () =>
          (await readCaptureStatus()).historyCallCounts,
      })
      ref = await transport.upload({
        generationId: input.generationId,
        generationInputDigest,
        path: sealed.path,
        artifactSha256: sealed.artifactSha256,
        artifactBytes: sealed.artifactBytes,
      })
      artifact = await openGaWatchCaptureArtifact({
        path: sealed.path,
        expectedSha256: sealed.artifactSha256,
        expectedBytes: sealed.artifactBytes,
      })
      assertCaptureRefMatchesHeader(ref, artifact.header, artifact.headerSha256)
      qualificationDigest = parsed(
        qualificationResponseSchema,
        await ingest({
          action: "history_qualification",
          generationId: input.generationId,
          generationInputDigest,
          qualification: {
            ...(artifact.header.baseQualification as object),
            snapshotRef: ref,
          },
        }),
      ).qualificationDigest
    }
    assertGaCaptureHeaderBinding(artifact.header, binding)
    assertCaptureRefMatchesHeader(ref, artifact.header, artifact.headerSha256)
    history = await createSealedGaWatchHistoryReader({
      artifact,
      artifactSha256: ref.artifactSha256,
    })
    historyDefinition = await readHistoricalDefinition(
      history,
      input.inputCutoff,
    )
    sealedCaptureDirectory = directory
  } else {
    history = input.historyRequired
      ? (provided.history ?? createHistoryReader())
      : undefined
    if (input.historyRequired && !history)
      throw new HistoricalAnalyticsError("analytics_unavailable")
    historyDefinition = history
      ? await readHistoricalDefinition(history, input.inputCutoff)
      : undefined
    if (input.historyRequired && historyDefinition?.provider !== "ga_data_api")
      throw new HistoricalAnalyticsError("analytics_unavailable")
    qualificationDigest =
      historyDefinition?.provider === "ga_data_api"
        ? parsed(
            qualificationResponseSchema,
            await ingest({
              action: "history_qualification",
              generationId: input.generationId,
              generationInputDigest,
              qualification: historyDefinition.qualification,
            }),
          ).qualificationDigest
        : undefined
  }
  if (input.snapshotMode) {
    const status = parsed(
      captureStatusSchema,
      await ingest({
        action: "status",
        generationId: input.generationId,
        generationInputDigest,
      }),
    )
    if (!status.capacityFresh) {
      if (sealedCaptureDirectory)
        await rm(sealedCaptureDirectory, { recursive: true, force: true })
      return {
        state: "incomplete",
        generationId: input.generationId,
        completedSourceCount: 0,
        failedSourceCount: 0,
      }
    }
  }
  try {
    const model = provided.model ?? createAstraModel()
    let completedSourceCount = 0
    let failedSourceCount = 0
    let busySourceCount = 0
    const runSource = async (source: Video) => {
      let claim: z.output<typeof claimSchema>
      try {
        claim = parsed(
          claimSchema,
          await ingest({
            action: "claim",
            generationId: input.generationId,
            generationInputDigest,
            sourceVideoId: source.id,
            claimId: randomUUID(),
          }),
        )
      } catch (error) {
        if (!isLiveClaimConflict(error)) throw error
        busySourceCount += 1
        return
      }
      if (
        claim.sourceState === "complete_edges" ||
        claim.sourceState === "complete_empty"
      ) {
        completedSourceCount += 1
        return
      }
      if (claim.sourceState === "failed") {
        failedSourceCount += 1
        return
      }
      if (!claim.leaseToken || claim.checkpointRevision === undefined)
        throw new CatalogBuildError("admin_contract_rejected")
      try {
        await processSource(
          {
            input,
            generationInputDigest,
            catalog,
            ingest,
            model,
            videos,
            candidateIdsBySource: retrieval.candidateIdsBySource,
            history: input.snapshotMode
              ? history
              : (provided.history ??
                (input.historyRequired
                  ? createHistoryReader({
                      sourceVideoId: source.id,
                      leaseToken: claim.leaseToken,
                    })
                  : undefined)),
            historyDefinition,
            qualificationDigest,
            assertExternalAdmission,
          },
          source,
          claim.leaseToken,
          claim.checkpoint ?? null,
          claim.checkpointRevision,
        )
        completedSourceCount += 1
      } catch (error) {
        const code =
          error instanceof CatalogBuildError
            ? error.code
            : error instanceof HistoricalAnalyticsError
              ? error.code
              : error instanceof Error
                ? error.message
                : "internal_failure"
        if (
          ![
            "provider_invalid_output",
            "analytics_incomplete",
            "input_stale",
          ].includes(code)
        )
          throw error
        await ingest({
          action: "fail",
          generationId: input.generationId,
          generationInputDigest,
          sourceVideoId: source.id,
          leaseToken: claim.leaseToken,
          failureCode: code,
        })
        failedSourceCount += 1
      }
    }
    let nextSourceIndex = 0
    let unexpectedError: unknown
    const worker = async () => {
      while (!stopped && nextSourceIndex < videos.length) {
        const source = videos[nextSourceIndex++]!
        try {
          await runSource(source)
        } catch (error) {
          stopAdmission()
          unexpectedError ??= error
        }
      }
    }
    const settledWorkers = await Promise.allSettled(
      Array.from({ length: input.sourceConcurrency }, () => worker()),
    )
    const rejectedWorker = settledWorkers.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    if (rejectedWorker) throw rejectedWorker.reason
    if (stopped) throw unexpectedError
    if (failedSourceCount > 0)
      return {
        state: "failed",
        generationId: input.generationId,
        completedSourceCount,
        failedSourceCount,
      }
    if (busySourceCount > 0)
      return {
        state: "incomplete",
        generationId: input.generationId,
        completedSourceCount,
        failedSourceCount: 0,
      }
    const completion = parsed(
      stateSchema,
      await ingest({
        action: "complete",
        generationId: input.generationId,
        generationInputDigest,
      }),
    )
    if (completion.state !== "complete")
      throw new CatalogBuildError("admin_contract_rejected")
    return {
      state: "complete",
      generationId: input.generationId,
      completedSourceCount,
      failedSourceCount: 0,
    }
  } finally {
    if (sealedCaptureDirectory)
      await rm(sealedCaptureDirectory, { recursive: true, force: true })
  }
}
