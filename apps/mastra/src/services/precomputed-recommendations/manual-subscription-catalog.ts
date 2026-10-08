import { createHash, randomUUID } from "node:crypto"

import { z } from "zod"

import {
  buildCandidateRetrieval,
  CANDIDATE_RETRIEVAL_REVISION,
} from "./candidate-retrieval"
import { PRECOMPUTED_MODEL_ID } from "./astra-provider"
import type { CodexAccountAttestation } from "./codex-local-account"
import type { ReservationAwareStructuredModel } from "./codex-subscription-astra"
import type {
  createGaCaptureImportClient,
  GaImportDestination,
} from "./ga-capture-import-client"
import type { loadImportedGaWatchHistory } from "./ga-capture-import-reader"
import {
  runContentProfile,
  type ProfilePersistencePort,
} from "./content-profile-executor"
import {
  finalizeEdgeSource,
  planEdgeMemberPage,
  runEdgeBatch,
  type EdgeBatchPersistencePort,
  type EdgeMemberInput,
  type ReadyEdgeProfile,
} from "./edge-batch-executor"
import {
  readHistoricalSnapshot,
  type HistoricalSnapshot,
} from "./historical-analytics"
import type { SourceCatalog, SourceIngest, Video } from "./source-generation"

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

export class ManualSubscriptionCatalogError extends Error {
  constructor(
    readonly code:
      | "catalog_mismatch"
      | "catalog_unavailable"
      | "admission_refused"
      | "capacity_stopped"
      | "import_unavailable"
      | "source_failed"
      | "usage_uncertain"
      | "admin_unavailable"
      | "input_invalid",
  ) {
    super(code)
    this.name = "ManualSubscriptionCatalogError"
  }
}

export type ReviewedCatalog = {
  sourceVideoIds: string[]
  sourceSetDigest: string
  selectedCorpusDigest: string
  candidatePoolDigest: string
}

const capacityMeasurement = z
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
  .strict()

type ImportedHistory = Awaited<ReturnType<typeof loadImportedGaWatchHistory>>

export type ManualSubscriptionCatalogInput = {
  invocation: "start" | "resume"
  generationId: string
  generationInputDigest: string
  attemptId: string
  inputCutoff: string
  initiatingAccountRef: string
  reviewed: ReviewedCatalog
  destination: GaImportDestination
  originGenerationId: string
  work:
    | { mode: "full" }
    | {
        mode: "pilot"
        sources: Array<{ sourceVideoId: string; exclusiveEndRank: number }>
      }
}

export type ManualSubscriptionCatalogPorts = {
  catalog: SourceCatalog
  ingest: SourceIngest
  model: ReservationAwareStructuredModel
  readAttestation: () => Promise<CodexAccountAttestation>
  profilePersistence: ProfilePersistencePort
  edgePersistence: EdgeBatchPersistencePort
  importClient: Pick<
    ReturnType<typeof createGaCaptureImportClient>,
    "probeOrigin" | "prepare" | "copyBind" | "status"
  >
  loadImport: (destination: GaImportDestination) => Promise<ImportedHistory>
  measureCapacity: (probe: {
    observedDbBytes: number
    clusterSystemId: string
    availableBytes: null
  }) => Promise<z.output<typeof capacityMeasurement>>
}

export type ManualSubscriptionCatalogResult = {
  state: "completed" | "stopped"
  reason?:
    | "pilot_boundary"
    | "admission_refused"
    | "capacity_stopped"
    | "import_unavailable"
    | "source_failed"
    | "usage_uncertain"
    | "admin_unavailable"
  generationId: string
  attemptId: string
  completedSourceCount: number
  processedPageCount: number
  knownUsage: {
    profileCallCount: number
    profileInputTokens: number
    profileOutputTokens: number
    edgeBatchCallCount: number
    edgeBatchInputTokens: number
    edgeBatchOutputTokens: number
  } | null
}

function cachedChunks(catalog: SourceCatalog): SourceCatalog {
  const chunks = new Map<string, ReturnType<SourceCatalog["chunks"]>>()
  return {
    video: (input) => catalog.video(input),
    catalog: (input) => catalog.catalog(input),
    chunks(input) {
      const key = JSON.stringify(input)
      let result = chunks.get(key)
      if (!result) {
        result = catalog.chunks(input)
        chunks.set(key, result)
      }
      return result
    },
  }
}

/** Re-observe the whole catalog and selected transcript corpus before mutation. */
export async function preflightManualCatalog(
  catalog: SourceCatalog,
  cutoff: string,
  reviewed: ReviewedCatalog,
): Promise<{
  catalog: SourceCatalog
  videos: Video[]
  retrieval: Awaited<ReturnType<typeof buildCandidateRetrieval>>
}> {
  const ids = reviewed.sourceVideoIds
  if (
    !ids.length ||
    ids.length > 20_000 ||
    ids.some(
      (id, index) =>
        !id ||
        id.length > 191 ||
        id !== id.trim() ||
        (index > 0 && ids[index - 1]! >= id),
    ) ||
    digest(ids) !== reviewed.sourceSetDigest
  )
    throw new ManualSubscriptionCatalogError("catalog_mismatch")
  const cached = cachedChunks(catalog)
  const videos: Video[] = []
  const seen = new Set<string>()
  let afterVideoId: string | undefined
  for (let pageIndex = 0; pageIndex < 2_000; pageIndex++) {
    let page: Awaited<ReturnType<SourceCatalog["catalog"]>>
    try {
      page = await cached.catalog({ cutoff, afterVideoId })
    } catch {
      throw new ManualSubscriptionCatalogError("catalog_unavailable")
    }
    if (
      page.videos.length > 100 ||
      page.videos.some((video) => seen.has(video.id)) ||
      (page.nextCursor !== null &&
        (!page.nextCursor || page.nextCursor === afterVideoId))
    )
      throw new ManualSubscriptionCatalogError("catalog_unavailable")
    for (const video of page.videos) {
      seen.add(video.id)
      videos.push(video)
    }
    if (page.nextCursor === null) break
    afterVideoId = page.nextCursor
    if (pageIndex === 1_999)
      throw new ManualSubscriptionCatalogError("catalog_unavailable")
  }
  videos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (
    videos.length !== ids.length ||
    videos.some((video, index) => video.id !== ids[index])
  )
    throw new ManualSubscriptionCatalogError("catalog_mismatch")
  let retrieval: Awaited<ReturnType<typeof buildCandidateRetrieval>>
  try {
    retrieval = await buildCandidateRetrieval(cached, videos, cutoff)
  } catch {
    throw new ManualSubscriptionCatalogError("catalog_unavailable")
  }
  if (
    retrieval.selectedCorpusDigest !== reviewed.selectedCorpusDigest ||
    retrieval.candidatePoolDigest !== reviewed.candidatePoolDigest
  )
    throw new ManualSubscriptionCatalogError("catalog_mismatch")
  return { catalog: cached, videos, retrieval }
}

const BUILD_PROMPT_VERSION = "subscription-profile-edge-v1"
const PROFILE_PROMPT_VERSION = "complete-profile-v1"
const PROFILE_SCHEMA_VERSION = "complete-profile-schema-v1"
const EDGE_PROMPT_VERSION = "shared-edge-v1"
const EDGE_SCHEMA_VERSION = "shared-edge-schema-v1"
const MAX_PROFILE_PART_BYTES = 24_576
const CAPACITY_REFRESH_MS = 25 * 60_000
const HEARTBEAT_MS = 5 * 60_000
const hex = /^[a-f0-9]{64}$/u

export function manualGenerationInputDigest(input: {
  inputCutoff: string
  videos: readonly Video[]
  selectedCorpusDigest: string
  candidatePoolDigest: string
}): string {
  return digest({
    version: "manual_subscription_catalog_v1",
    protocolVersion: 4,
    cutoff: input.inputCutoff,
    inputMode: "historical_analytics",
    inputSnapshotMode: "observed_fenced",
    importPolicy: "ga_capture_import_v1",
    modelId: PRECOMPUTED_MODEL_ID,
    backend: "codex_chatgpt_subscription",
    promptVersion: BUILD_PROMPT_VERSION,
    profilePromptVersion: PROFILE_PROMPT_VERSION,
    profileSchemaVersion: PROFILE_SCHEMA_VERSION,
    edgePromptVersion: EDGE_PROMPT_VERSION,
    edgeSchemaVersion: EDGE_SCHEMA_VERSION,
    videos: input.videos,
    sourceSetDigest: digest(input.videos.map((video) => video.id)),
    candidateRetrievalRevision: CANDIDATE_RETRIEVAL_REVISION,
    selectedCorpusDigest: input.selectedCorpusDigest,
    candidatePoolDigest: input.candidatePoolDigest,
  })
}

function parsed<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new ManualSubscriptionCatalogError("admin_unavailable")
  return result.data
}

const id = z.string().trim().min(1).max(191)
const scopeReply = z.object({ generationId: id })
const stateReply = scopeReply.extend({ state: z.string() })
const claimReply = scopeReply.extend({
  sourceState: z.enum([
    "pending",
    "claimed",
    "complete_edges",
    "complete_empty",
    "failed",
  ]),
  leaseToken: z.uuid().nullable(),
  checkpointRevision: z.number().int().nonnegative().optional(),
  leaseExpiresAt: z.string().datetime().optional(),
  checkpoint: z.unknown().nullable().optional(),
  historicalProvenance: z.unknown().nullable().optional(),
})
const checkpointReply = scopeReply.extend({
  checkpointRevision: z.number().int().positive(),
  replay: z.boolean(),
})
const statusReply = scopeReply.extend({
  usage: z.object({
    attempts: z.array(
      z.object({
        attemptId: z.uuid(),
        profileCallCount: z.number().int().nonnegative(),
        profileInputTokens: z.number().int().nonnegative(),
        profileOutputTokens: z.number().int().nonnegative(),
        edgeBatchCallCount: z.number().int().nonnegative(),
        edgeBatchInputTokens: z.number().int().nonnegative(),
        edgeBatchOutputTokens: z.number().int().nonnegative(),
      }),
    ),
  }),
})

function classify(
  error: unknown,
): NonNullable<ManualSubscriptionCatalogResult["reason"]> {
  if (
    error &&
    typeof error === "object" &&
    "consumptionUnknown" in error &&
    error.consumptionUnknown === true
  )
    return "usage_uncertain"
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined
  if (
    code === "usage_uncertain" ||
    code === "usage_unknown" ||
    code === "adapter_paused" ||
    code === "reservation_uncertain"
  )
    return "usage_uncertain"
  if (
    code === "allowance_insufficient" ||
    code === "allowance_stale" ||
    code === "allowance_unavailable" ||
    code === "identity_mismatch" ||
    code === "identity_stale" ||
    code === "identity_unavailable"
  )
    return "admission_refused"
  if (code === "capacity_blocked" || code === "capacity_stopped")
    return "capacity_stopped"
  if (
    code === "source_failed" ||
    code === "profile_invalid" ||
    code === "edge_invalid"
  )
    return "source_failed"
  if (code === "import_unavailable") return "import_unavailable"
  if (
    typeof code === "string" &&
    (code.startsWith("ga_import_") || code.startsWith("analytics_"))
  )
    return "import_unavailable"
  return "admin_unavailable"
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)]),
      )
    return value
  }
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function combinedHistorical(
  snapshots: ReadonlyMap<string, HistoricalSnapshot>,
): HistoricalSnapshot {
  const values = [...snapshots.values()]
  const first = values[0]
  if (!first) throw new ManualSubscriptionCatalogError("import_unavailable")
  for (const value of values.slice(1))
    if (
      JSON.stringify(value.definitionsForModel) !==
      JSON.stringify(first.definitionsForModel)
    )
      throw new ManualSubscriptionCatalogError("import_unavailable")
  return {
    provenance: first.provenance,
    queryUsage: new Map(),
    definitionsForModel: first.definitionsForModel,
    signal(videoId) {
      let shared: ReturnType<HistoricalSnapshot["signal"]> = null
      for (const snapshot of values) {
        const signal = snapshot.signal(videoId)
        if (signal === null) continue
        if (
          shared !== null &&
          JSON.stringify(shared) !== JSON.stringify(signal)
        )
          throw new ManualSubscriptionCatalogError("import_unavailable")
        shared = signal
      }
      return shared
    },
    transition: (source, target) =>
      snapshots.get(source)?.transition(source, target) ?? null,
    navigation: (source, target) =>
      snapshots.get(source)?.navigation?.(source, target) ?? null,
  }
}

type ActiveSource = {
  source: Video
  orderedCandidateIds: string[]
  exclusiveEndRank: number
  leaseToken: string
  checkpointRevision: number
  pageIndex: number
  startRank: number
  sourceProfile: ReadyEdgeProfile
  targetsByVideoId: Map<string, { video: Video; profile: ReadyEdgeProfile }>
  snapshot: HistoricalSnapshot
  finalized: boolean
}

async function sourceProgress(
  source: ActiveSource,
  edgePersistence: EdgeBatchPersistencePort,
  generationId: string,
  generationInputDigest: string,
): Promise<void> {
  let afterCallId: string | undefined
  const calls: Awaited<
    ReturnType<EdgeBatchPersistencePort["status"]>
  >["calls"] = []
  const sourceCandidateDigest = digest(source.orderedCandidateIds)
  let firstStatus:
    | Awaited<ReturnType<EdgeBatchPersistencePort["status"]>>
    | undefined
  for (let page = 0; page < 9; page++) {
    const status = await edgePersistence.status({
      action: "edge_batch_status",
      generationId,
      generationInputDigest,
      sourceVideoId: source.source.id,
      ...(afterCallId ? { afterCallId } : {}),
    })
    if (
      status.generationId !== generationId ||
      status.sourceVideoId !== source.source.id ||
      status.sourceState !== "claimed" ||
      status.checkpointRevision < source.checkpointRevision ||
      (status.sourceCandidateCount !== null &&
        status.sourceCandidateCount !== source.orderedCandidateIds.length) ||
      (status.sourceCandidateDigest !== null &&
        status.sourceCandidateDigest !== sourceCandidateDigest) ||
      (firstStatus !== undefined &&
        (firstStatus.checkpointRevision !== status.checkpointRevision ||
          firstStatus.sourceCandidateCount !== status.sourceCandidateCount ||
          firstStatus.sourceCandidateDigest !== status.sourceCandidateDigest))
    )
      throw new ManualSubscriptionCatalogError("admin_unavailable")
    firstStatus ??= status
    calls.push(...status.calls)
    if (status.nextCursor === null) break
    if (!status.nextCursor || status.nextCursor === afterCallId || page === 8)
      throw new ManualSubscriptionCatalogError("admin_unavailable")
    afterCallId = status.nextCursor
  }
  if (calls.some((call) => call.status === "pending"))
    throw new ManualSubscriptionCatalogError("usage_uncertain")
  if (calls.some((call) => call.applicationState === "rejected_unapplied"))
    throw new ManualSubscriptionCatalogError("source_failed")
  if (calls.some((call) => call.applicationState === "stale_unapplied"))
    throw new ManualSubscriptionCatalogError("usage_uncertain")
  const applied = calls
    .filter(
      (call) =>
        call.applicationState === "applied_edges" ||
        call.applicationState === "applied_empty",
    )
    .sort((a, b) => a.pageIndex - b.pageIndex)
  let rank = 0
  for (const [pageIndex, call] of applied.entries()) {
    const planned = planEdgeMemberPage({
      sourceVideoId: source.source.id,
      orderedCandidateIds: source.orderedCandidateIds,
      profileKeysByVideoId: new Map(
        [...source.targetsByVideoId].map(([id, target]) => [
          id,
          target.profile.cacheKey,
        ]),
      ),
      pageIndex,
      startRank: rank,
      pageSize: call.candidates.length,
    })
    if (
      call.pageIndex !== pageIndex ||
      call.status !== "succeeded" ||
      call.candidates.length < 1 ||
      call.candidatePageDigest !== planned.candidatePageDigest ||
      JSON.stringify(call.candidates) !== JSON.stringify(planned.candidates) ||
      call.candidates.some(
        (candidate, index) =>
          candidate.poolRank !== rank + index ||
          candidate.targetVideoId !==
            source.orderedCandidateIds[rank + index] ||
          candidate.targetProfileKey !==
            source.targetsByVideoId.get(candidate.targetVideoId)?.profile
              .cacheKey,
      )
    )
      throw new ManualSubscriptionCatalogError("catalog_mismatch")
    rank += call.candidates.length
  }
  source.startRank = rank
  source.pageIndex = applied.length
  if (
    applied.length > 0 &&
    applied.at(-1)!.appliedRevision !== firstStatus?.checkpointRevision
  )
    throw new ManualSubscriptionCatalogError("usage_uncertain")
  if (firstStatus) source.checkpointRevision = firstStatus.checkpointRevision
  if (source.startRank > source.exclusiveEndRank)
    throw new ManualSubscriptionCatalogError("catalog_mismatch")
}

/** Explicit invocation only. Every external capability is injected by the local CLI. */
export async function runManualSubscriptionCatalog(
  input: ManualSubscriptionCatalogInput,
  ports: ManualSubscriptionCatalogPorts,
): Promise<ManualSubscriptionCatalogResult> {
  if (
    !id.safeParse(input.generationId).success ||
    !id.safeParse(input.originGenerationId).success ||
    input.generationId === input.originGenerationId ||
    !z.uuid().safeParse(input.attemptId).success ||
    !z.string().datetime().safeParse(input.inputCutoff).success ||
    !hex.test(input.generationInputDigest) ||
    input.destination.generationId !== input.generationId ||
    input.destination.generationInputDigest !== input.generationInputDigest ||
    input.destination.inputCutoff !== input.inputCutoff ||
    input.destination.sourceSetDigest !== input.reviewed.sourceSetDigest ||
    input.destination.selectedCorpusDigest !==
      input.reviewed.selectedCorpusDigest ||
    input.destination.candidatePoolDigest !== input.reviewed.candidatePoolDigest
  )
    throw new ManualSubscriptionCatalogError("input_invalid")
  const frozen = await preflightManualCatalog(
    ports.catalog,
    input.inputCutoff,
    input.reviewed,
  )
  if (
    manualGenerationInputDigest({
      inputCutoff: input.inputCutoff,
      videos: frozen.videos,
      selectedCorpusDigest: frozen.retrieval.selectedCorpusDigest,
      candidatePoolDigest: frozen.retrieval.candidatePoolDigest,
    }) !== input.generationInputDigest
  )
    throw new ManualSubscriptionCatalogError("catalog_mismatch")
  const byId = new Map(frozen.videos.map((video) => [video.id, video]))
  const work =
    input.work.mode === "full"
      ? frozen.videos.map((video) => ({
          sourceVideoId: video.id,
          exclusiveEndRank:
            frozen.retrieval.candidateIdsBySource.get(video.id)?.length ?? -1,
        }))
      : input.work.sources
  if (
    work.length === 0 ||
    new Set(work.map((item) => item.sourceVideoId)).size !== work.length ||
    work.some((item) => {
      const pool = frozen.retrieval.candidateIdsBySource.get(item.sourceVideoId)
      return (
        !pool ||
        !Number.isSafeInteger(item.exclusiveEndRank) ||
        item.exclusiveEndRank < 0 ||
        item.exclusiveEndRank > pool.length ||
        (pool.length > 0 && item.exclusiveEndRank === 0)
      )
    })
  )
    throw new ManualSubscriptionCatalogError("catalog_mismatch")
  const attestation = await ports.readAttestation()
  if (
    attestation.admission !== "admitted" ||
    attestation.modelId !== PRECOMPUTED_MODEL_ID ||
    attestation.identity.accountRef !== input.initiatingAccountRef ||
    attestation.allowance.accountRef !== input.initiatingAccountRef ||
    attestation.allowance.billingBasis !== "included_subscription" ||
    ![attestation.identity.observedAt, attestation.allowance.observedAt].every(
      (observedAt) => {
        const age = Date.now() - Date.parse(observedAt)
        return Number.isFinite(age) && age >= 0 && age <= 60_000
      },
    ) ||
    !Number.isFinite(attestation.allowance.weeklyRemainingPercent) ||
    attestation.allowance.weeklyRemainingPercent <= 25 ||
    attestation.allowance.weeklyRemainingPercent > 100 ||
    (attestation.allowance.fiveHour.kind === "limited" &&
      (!Number.isFinite(attestation.allowance.fiveHour.remainingPercent) ||
        attestation.allowance.fiveHour.remainingPercent <= 25 ||
        attestation.allowance.fiveHour.remainingPercent > 100))
  )
    throw new ManualSubscriptionCatalogError("admission_refused")
  const executionAttempt = {
    attemptId: input.attemptId,
    invocation: input.invocation,
    accountRef: input.initiatingAccountRef,
    backend: "codex_chatgpt_subscription" as const,
    billingBasis: "included_subscription" as const,
    authMethod: "chatgpt" as const,
    modelId: PRECOMPUTED_MODEL_ID,
    identityObservedAt: attestation.identity.observedAt,
    allowanceObservedAt: attestation.allowance.observedAt,
    weeklyRemainingPercent: attestation.allowance.weeklyRemainingPercent,
    fiveHour:
      attestation.allowance.fiveHour.kind === "limited"
        ? {
            kind: "limited" as const,
            remainingPercent: attestation.allowance.fiveHour.remainingPercent,
          }
        : { kind: "not_applicable" as const },
  }
  const scope = {
    generationId: input.generationId,
    generationInputDigest: input.generationInputDigest,
  }
  const importState =
    input.invocation === "resume"
      ? await ports.importClient.status({ destination: input.destination })
      : await ports.importClient.probeOrigin({
          originGenerationId: input.originGenerationId,
        })
  if (
    input.invocation === "resume" &&
    (!("state" in importState) ||
      (importState.state !== "bound" && importState.state !== "absent"))
  )
    throw new ManualSubscriptionCatalogError("import_unavailable")
  const originProof =
    "origin" in importState
      ? importState
      : importState.state === "absent"
        ? await ports.importClient.probeOrigin({
            originGenerationId: input.originGenerationId,
          })
        : null
  if (originProof) {
    const origin = originProof.origin
    const destination = input.destination
    if (
      origin.generationId !== input.originGenerationId ||
      origin.sourceSetDigest !== destination.sourceSetDigest ||
      origin.inputCutoff !== destination.inputCutoff ||
      origin.selectedCorpusDigest !== destination.selectedCorpusDigest ||
      origin.routeMappingDigest !== destination.routeMappingDigest ||
      origin.sourcePatternTableDigest !==
        destination.sourcePatternTableDigest ||
      origin.querySpecDigest !== destination.querySpecDigest ||
      origin.propertyId !== destination.propertyId ||
      origin.propertyTimeZone !== destination.propertyTimeZone ||
      origin.requestedStart !== destination.requestedStart ||
      origin.requestedEnd !== destination.requestedEnd ||
      origin.usableStart !== destination.usableStart ||
      origin.usableEnd !== destination.usableEnd ||
      origin.requestedCoverageDigest !== destination.requestedCoverageDigest ||
      origin.usableCoverageDigest !== destination.usableCoverageDigest
    )
      throw new ManualSubscriptionCatalogError("import_unavailable")
  }
  let attempted = false
  let imported: ImportedHistory | undefined
  let completedSourceCount = 0
  let processedPageCount = 0
  let reason: ManualSubscriptionCatalogResult["reason"]
  let lastCapacityAt = 0
  const activeLeases = new Map<string, string>()
  let heartbeatFailure: unknown
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  const send = async <T extends z.ZodType>(schema: T, payload: unknown) =>
    parsed(schema, await ports.ingest(payload))
  const refreshCapacity = async (force = false) => {
    if (!force && Date.now() - lastCapacityAt < CAPACITY_REFRESH_MS) return
    const probe = await send(
      z.object({
        observedDbBytes: z.number().int().nonnegative(),
        clusterSystemId: z.string().regex(/^\d{1,20}$/u),
        availableBytes: z.null(),
      }),
      { action: "capacity_probe", ...scope },
    )
    let measurement: z.output<typeof capacityMeasurement>
    try {
      measurement = capacityMeasurement.parse(
        await ports.measureCapacity(probe),
      )
    } catch {
      throw new ManualSubscriptionCatalogError("capacity_stopped")
    }
    const measurementAge = Date.now() - Date.parse(measurement.measuredAt)
    if (
      measurement.observedDbBytes !== probe.observedDbBytes ||
      measurement.clusterSystemId !== probe.clusterSystemId ||
      !Number.isFinite(measurementAge) ||
      measurementAge < 0 ||
      measurementAge > CAPACITY_REFRESH_MS
    )
      throw new ManualSubscriptionCatalogError("capacity_stopped")
    const capacity = await send(stateReply, {
      action: "capacity",
      ...scope,
      attemptId: input.attemptId,
      measurement,
    })
    if (
      capacity.generationId !== input.generationId ||
      capacity.state !== "incomplete"
    )
      throw new ManualSubscriptionCatalogError("capacity_stopped")
    lastCapacityAt = Date.parse(measurement.measuredAt)
  }
  const admittedModel: ReservationAwareStructuredModel = {
    async generateReserved(request, reserve) {
      if (heartbeatFailure) throw heartbeatFailure
      await refreshCapacity()
      return ports.model.generateReserved(request, reserve)
    },
  }
  const heartbeatAll = async () => {
    if (heartbeatFailure) throw heartbeatFailure
    for (const [sourceVideoId, leaseToken] of activeLeases) {
      const reply = await send(
        z.object({ sourceState: z.literal("claimed") }),
        {
          action: "heartbeat",
          ...scope,
          attemptId: input.attemptId,
          sourceVideoId,
          leaseToken,
        },
      )
      if (reply.sourceState !== "claimed")
        throw new ManualSubscriptionCatalogError("source_failed")
    }
  }
  try {
    if (input.invocation === "start") {
      const started = await send(stateReply, {
        action: "start",
        protocolVersion: 4,
        generationId: input.generationId,
        modelId: PRECOMPUTED_MODEL_ID,
        promptVersion: BUILD_PROMPT_VERSION,
        inputMode: "historical_analytics",
        inputSnapshotMode: "observed_fenced",
        inputDigest: input.generationInputDigest,
        sourceSetDigest: input.reviewed.sourceSetDigest,
        inputCutoff: input.inputCutoff,
        expectedSourceCount: frozen.videos.length,
        executionAttempt,
      })
      if (
        started.generationId !== input.generationId ||
        started.state !== "incomplete"
      )
        throw new ManualSubscriptionCatalogError("admin_unavailable")
    } else {
      const resumed = await send(scopeReply, {
        action: "resume_attempt",
        ...scope,
        executionAttempt,
      })
      if (resumed.generationId !== input.generationId)
        throw new ManualSubscriptionCatalogError("admin_unavailable")
    }
    attempted = true
    if (input.invocation === "start") {
      const manifest = await send(scopeReply, {
        action: "manifest",
        ...scope,
        attemptId: input.attemptId,
        sourceVideoIds: input.reviewed.sourceVideoIds,
      })
      if (manifest.generationId !== input.generationId)
        throw new ManualSubscriptionCatalogError("admin_unavailable")
    }
    await refreshCapacity(true)
    if (originProof) {
      await ports.importClient.prepare({
        destination: input.destination,
        attemptId: input.attemptId,
      })
      const bound = await ports.importClient.copyBind({
        destination: input.destination,
        attemptId: input.attemptId,
        origin: originProof.origin,
        originProofDigest: originProof.originProofDigest,
      })
      if (bound.state !== "bound")
        throw new ManualSubscriptionCatalogError("import_unavailable")
    }
    imported = await ports.loadImport(input.destination)
    const boundStatus = await ports.importClient.status({
      destination: input.destination,
    })
    if (
      boundStatus.state !== "bound" ||
      boundStatus.importBinding.bindingDigest !==
        imported.importBinding.bindingDigest ||
      boundStatus.qualificationDigest !== imported.qualificationDigest
    )
      throw new ManualSubscriptionCatalogError("import_unavailable")
    const profileIds = new Set<string>()
    for (const item of work) {
      profileIds.add(item.sourceVideoId)
      const pool = frozen.retrieval.candidateIdsBySource.get(
        item.sourceVideoId,
      )!
      for (const target of pool.slice(0, item.exclusiveEndRank))
        profileIds.add(target)
    }
    const readyProfiles = new Map<string, ReadyEdgeProfile>()
    for (const videoId of [...profileIds].sort()) {
      const video = byId.get(videoId)
      if (!video) throw new ManualSubscriptionCatalogError("catalog_mismatch")
      const ready = await runContentProfile({
        ...scope,
        attemptId: input.attemptId,
        inputCutoff: input.inputCutoff,
        video,
        catalog: frozen.catalog,
        modelId: PRECOMPUTED_MODEL_ID,
        backend: "codex_chatgpt_subscription",
        promptVersion: PROFILE_PROMPT_VERSION,
        schemaVersion: PROFILE_SCHEMA_VERSION,
        maxPartBytes: MAX_PROFILE_PART_BYTES,
        model: admittedModel,
        persistence: ports.profilePersistence,
      })
      readyProfiles.set(videoId, {
        state: "ready",
        kind: ready.kind,
        cacheKey: ready.cacheKey,
        profile: ready.profile,
      })
    }
    heartbeatTimer = setInterval(() => {
      void heartbeatAll().catch((error: unknown) => {
        heartbeatFailure ??= error
      })
    }, HEARTBEAT_MS)
    heartbeatTimer.unref()
    for (let groupStart = 0; groupStart < work.length; groupStart += 2) {
      const active: ActiveSource[] = []
      for (const item of work.slice(groupStart, groupStart + 2)) {
        await refreshCapacity()
        const source = byId.get(item.sourceVideoId)!
        const orderedCandidateIds = frozen.retrieval.candidateIdsBySource.get(
          source.id,
        )!
        const snapshot = await readHistoricalSnapshot({
          reader: imported.reader,
          definition: imported.definition,
          catalog: frozen.videos,
          routeCatalog: frozen.videos,
          sourceVideoId: source.id,
          selectedVideoIds: orderedCandidateIds,
          includeSourceEngagement: true,
          cutoff: input.inputCutoff,
        })
        const provenance = snapshot.provenance
        if (
          provenance.captureMode !== "imported_capture_derived_v1" ||
          provenance.importBindingDigest !==
            imported.importBinding.bindingDigest ||
          provenance.artifactSha256 !==
            imported.importBinding.copy.artifactSha256 ||
          !provenance.derivedSubsetDigest ||
          provenance.queryExecutionCount !== 0 ||
          !provenance.navigationCoverage
        )
          throw new ManualSubscriptionCatalogError("import_unavailable")
        const claimed = await send(claimReply, {
          action: "claim",
          ...scope,
          attemptId: input.attemptId,
          sourceVideoId: source.id,
          claimId: randomUUID(),
        })
        if (claimed.generationId !== input.generationId)
          throw new ManualSubscriptionCatalogError("admin_unavailable")
        if (claimed.sourceState === "failed")
          throw new ManualSubscriptionCatalogError("source_failed")
        if (
          claimed.sourceState === "complete_edges" ||
          claimed.sourceState === "complete_empty"
        ) {
          completedSourceCount++
          continue
        }
        if (
          claimed.sourceState !== "claimed" ||
          !claimed.leaseToken ||
          claimed.checkpointRevision === undefined ||
          claimed.checkpoint === undefined ||
          claimed.historicalProvenance === undefined
        )
          throw new ManualSubscriptionCatalogError("admin_unavailable")
        activeLeases.set(source.id, claimed.leaseToken)
        const history = {
          evidenceKind: "referrer_navigation_v1",
          sourceResource: "properties/320198532",
          queryId: imported.definition.queryId,
          rangeStart: imported.definition.rangeStart,
          rangeEnd: imported.definition.rangeEnd,
          resultDigest: provenance.resultDigest,
          rowCount: provenance.rowCount,
          mappedRows: provenance.mappedRows,
          unmappedRows: provenance.unmappedRows,
          pageCount: provenance.pageCount,
          queryExecutionCount: 0,
          navigationCoverage: provenance.navigationCoverage,
          qualificationDigest: imported.qualificationDigest,
          captureMode: "imported_capture_derived_v1",
          importBindingDigest: imported.importBinding.bindingDigest,
          artifactSha256: imported.importBinding.copy.artifactSha256,
          derivedSubsetDigest: provenance.derivedSubsetDigest,
          pageCountKind: "virtual_validation",
          status: "complete",
        }
        const historySummary = {
          resultDigest: history.resultDigest,
          rowCount: history.rowCount,
          mappedRows: history.mappedRows,
          unmappedRows: history.unmappedRows,
          pageCount: history.pageCount,
          queryExecutionCount: history.queryExecutionCount,
          navigationCoverage: history.navigationCoverage,
          captureMode: history.captureMode,
          importBindingDigest: history.importBindingDigest,
          artifactSha256: history.artifactSha256,
          derivedSubsetDigest: history.derivedSubsetDigest,
          pageCountKind: history.pageCountKind,
        }
        let checkpointRevision = claimed.checkpointRevision
        if (claimed.checkpoint === null) {
          if (checkpointRevision !== 0 || claimed.historicalProvenance !== null)
            throw new ManualSubscriptionCatalogError("source_failed")
          const checkpoint = await send(checkpointReply, {
            action: "checkpoint",
            ...scope,
            attemptId: input.attemptId,
            sourceVideoId: source.id,
            leaseToken: claimed.leaseToken,
            expectedRevision: checkpointRevision,
            checkpointId: randomUUID(),
            checkpoint: {
              stage: "subscription_imported_history_ready",
              cursor: {},
              historySummary,
            },
          })
          if (
            checkpoint.generationId !== input.generationId ||
            checkpoint.checkpointRevision !== checkpointRevision + 1
          )
            throw new ManualSubscriptionCatalogError("admin_unavailable")
          checkpointRevision = checkpoint.checkpointRevision
        } else {
          const previous = z
            .object({ historySummary: z.unknown() })
            .safeParse(claimed.checkpoint)
          if (
            checkpointRevision < 1 ||
            !previous.success ||
            !sameCanonicalJson(previous.data.historySummary, historySummary)
          )
            throw new ManualSubscriptionCatalogError("source_failed")
        }
        if (claimed.historicalProvenance !== null) {
          if (!sameCanonicalJson(claimed.historicalProvenance, history))
            throw new ManualSubscriptionCatalogError("source_failed")
        } else {
          const savedHistory = await send(scopeReply, {
            action: "source_history",
            ...scope,
            attemptId: input.attemptId,
            sourceVideoId: source.id,
            leaseToken: claimed.leaseToken,
            history,
          })
          if (savedHistory.generationId !== input.generationId)
            throw new ManualSubscriptionCatalogError("admin_unavailable")
        }
        const targetsByVideoId = new Map<
          string,
          { video: Video; profile: ReadyEdgeProfile }
        >()
        for (const targetVideoId of orderedCandidateIds.slice(
          0,
          item.exclusiveEndRank,
        )) {
          const target = byId.get(targetVideoId)
          const profile = readyProfiles.get(targetVideoId)
          if (!target || !profile)
            throw new ManualSubscriptionCatalogError("catalog_mismatch")
          targetsByVideoId.set(targetVideoId, { video: target, profile })
        }
        const sourceProfile = readyProfiles.get(source.id)
        if (!sourceProfile)
          throw new ManualSubscriptionCatalogError("catalog_mismatch")
        const entry: ActiveSource = {
          source,
          orderedCandidateIds,
          exclusiveEndRank: item.exclusiveEndRank,
          leaseToken: claimed.leaseToken,
          checkpointRevision,
          pageIndex: 0,
          startRank: 0,
          sourceProfile,
          targetsByVideoId,
          snapshot,
          finalized: false,
        }
        await sourceProgress(
          entry,
          ports.edgePersistence,
          input.generationId,
          input.generationInputDigest,
        )
        active.push(entry)
      }
      while (
        active.some(
          (source) =>
            !source.finalized &&
            (source.startRank < source.exclusiveEndRank ||
              source.orderedCandidateIds.length === 0),
        )
      ) {
        if (heartbeatFailure) throw heartbeatFailure
        await heartbeatAll()
        const remaining = active.filter(
          (source) =>
            !source.finalized &&
            (source.startRank < source.exclusiveEndRank ||
              source.orderedCandidateIds.length === 0),
        )
        const batch =
          remaining[0]!.orderedCandidateIds.length === 0
            ? remaining.slice(0, 1)
            : remaining
                .filter((source) => source.orderedCandidateIds.length > 0)
                .slice(0, 2)
        const members: EdgeMemberInput[] = batch.map((source) => ({
          source: source.source,
          sourceProfile: source.sourceProfile,
          orderedCandidateIds: source.orderedCandidateIds,
          pageIndex: source.pageIndex,
          startRank: source.startRank,
          pageSize: Math.min(8, source.exclusiveEndRank - source.startRank),
          leaseToken: source.leaseToken,
          checkpointRevision: source.checkpointRevision,
          targetsByVideoId: source.targetsByVideoId,
        }))
        const historical = combinedHistorical(
          new Map(batch.map((source) => [source.source.id, source.snapshot])),
        )
        const result = await runEdgeBatch({
          ...scope,
          attemptId: input.attemptId,
          callId: randomUUID(),
          inputCutoff: input.inputCutoff,
          selectedCorpusDigest: input.reviewed.selectedCorpusDigest,
          candidatePoolDigest: input.reviewed.candidatePoolDigest,
          captureRefDigest: imported.importBinding.bindingDigest,
          modelId: PRECOMPUTED_MODEL_ID,
          backend: "codex_chatgpt_subscription",
          promptVersion: EDGE_PROMPT_VERSION,
          schemaVersion: EDGE_SCHEMA_VERSION,
          members,
          catalog: frozen.catalog,
          model: admittedModel,
          persistence: ports.edgePersistence,
          historical,
        })
        if (result.state !== "succeeded" && result.state !== "no_call")
          throw new ManualSubscriptionCatalogError("source_failed")
        for (const page of result.pages) {
          const source = active.find(
            (item) => item.source.id === page.sourceVideoId,
          )
          const receipt = result.members.find(
            (item) => item.sourceVideoId === page.sourceVideoId,
          )
          if (
            !source ||
            !receipt ||
            !["applied_edges", "applied_empty"].includes(
              receipt.applicationState,
            ) ||
            receipt.checkpointRevision < source.checkpointRevision ||
            (page.candidates.length === 0 &&
              source.orderedCandidateIds.length > 0)
          )
            throw new ManualSubscriptionCatalogError("usage_uncertain")
          source.startRank += page.candidates.length
          source.pageIndex += page.candidates.length > 0 ? 1 : 0
          source.checkpointRevision = receipt.checkpointRevision
          processedPageCount += page.candidates.length > 0 ? 1 : 0
          if (source.orderedCandidateIds.length === 0) {
            source.finalized = true
            activeLeases.delete(source.source.id)
            completedSourceCount++
          }
        }
      }
      for (const source of active) {
        if (
          source.finalized ||
          source.startRank !== source.orderedCandidateIds.length
        )
          continue
        await heartbeatAll()
        const finalized = await finalizeEdgeSource({
          ...scope,
          attemptId: input.attemptId,
          sourceVideoId: source.source.id,
          leaseToken: source.leaseToken,
          expectedRevision: source.checkpointRevision,
          sourceProfileKey: source.sourceProfile.cacheKey,
          orderedCandidateIds: source.orderedCandidateIds,
          profileKeysByVideoId: new Map(
            [...source.targetsByVideoId].map(([id, target]) => [
              id,
              target.profile.cacheKey,
            ]),
          ),
          persistence: ports.edgePersistence,
        })
        if (
          finalized.sourceState !== "complete_edges" &&
          finalized.sourceState !== "complete_empty"
        )
          throw new ManualSubscriptionCatalogError("source_failed")
        source.finalized = true
        activeLeases.delete(source.source.id)
        completedSourceCount++
      }
      for (const source of active) activeLeases.delete(source.source.id)
    }
    if (input.work.mode === "full") {
      if (completedSourceCount !== frozen.videos.length)
        throw new ManualSubscriptionCatalogError("source_failed")
      const completion = await send(stateReply, {
        action: "complete",
        ...scope,
        attemptId: input.attemptId,
      })
      if (
        completion.generationId !== input.generationId ||
        completion.state !== "complete"
      )
        throw new ManualSubscriptionCatalogError("source_failed")
    }
  } catch (error) {
    reason = classify(error)
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (imported)
      await imported.dispose().catch(() => {
        reason ??= "import_unavailable"
      })
  }
  let knownUsage: ManualSubscriptionCatalogResult["knownUsage"] = null
  if (attempted) {
    try {
      await send(scopeReply, {
        action: "attempt_close",
        ...scope,
        attemptId: input.attemptId,
        reason: reason
          ? "paused"
          : input.work.mode === "full"
            ? "completed"
            : "paused",
      })
      const report = await send(statusReply, { action: "status", ...scope })
      const own = report.usage.attempts.find(
        (item) => item.attemptId === input.attemptId,
      )
      if (own)
        knownUsage = {
          profileCallCount: own.profileCallCount,
          profileInputTokens: own.profileInputTokens,
          profileOutputTokens: own.profileOutputTokens,
          edgeBatchCallCount: own.edgeBatchCallCount,
          edgeBatchInputTokens: own.edgeBatchInputTokens,
          edgeBatchOutputTokens: own.edgeBatchOutputTokens,
        }
      else reason ??= "usage_uncertain"
    } catch {
      reason ??= "admin_unavailable"
    }
  }
  return {
    state: reason || input.work.mode === "pilot" ? "stopped" : "completed",
    ...(reason || input.work.mode === "pilot"
      ? { reason: reason ?? "pilot_boundary" }
      : {}),
    generationId: input.generationId,
    attemptId: input.attemptId,
    completedSourceCount,
    processedPageCount,
    knownUsage,
  }
}
