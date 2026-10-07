import { createHash, randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { isValidMastraRecommendationIngestBearer } from "@/auth/mastra-ingest-bearer"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import {
  PrecomputedRecommendationError,
  gaHistoricalQualification,
  precomputedChoiceSchema,
  validatePrecomputedChoices,
} from "./contract"
import { assertPrecomputedObservedVersion } from "./catalog"

const id = z.string().trim().min(1).max(191)
const hex = z.string().regex(/^[a-f0-9]{64}$/)
const nonnegative = z.number().int().nonnegative().safe()
const money = z.number().finite().nonnegative()
const base = z.object({
  generationId: id,
  generationInputDigest: hex,
})
const sourceBase = base.extend({ sourceVideoId: id, leaseToken: z.uuid() })
const navigationCoverage = z
  .object({
    candidateEvents: nonnegative,
    qualifiedEvents: nonnegative,
    homeEvents: nonnegative,
    selfEvents: nonnegative,
    crossHostEvents: nonnegative,
    malformedEvents: nonnegative,
    unmappedEvents: nonnegative,
    ambiguousEvents: nonnegative,
  })
  .strict()
const provisionalChoice = precomputedChoiceSchema
  .omit({ rank: true })
  .extend({ strength: z.number().int().min(0).max(100) })
const cursor = z
  .object({
    stage: z.string().trim().min(1).max(64).optional(),
    sourceAfterChunkId: id.nullable().optional(),
    catalogAfterVideoId: id.nullable().optional(),
    candidateVideoId: id.nullable().optional(),
    candidateAfterChunkId: id.nullable().optional(),
    catalogIndex: nonnegative.optional(),
    candidateIndex: nonnegative.optional(),
  })
  .strict()
const checkpoint = z
  .object({
    stage: z.string().trim().min(1).max(64),
    cursor,
    sourceSummaryEnglish: z.string().max(5_000).optional(),
    candidateIds: z.array(id).max(40).optional(),
    analyticsCandidateIds: z.array(id).max(40).optional(),
    bestJudgment: provisionalChoice.optional(),
    historySummary: z
      .object({
        resultDigest: hex,
        rowCount: nonnegative,
        mappedRows: nonnegative,
        unmappedRows: nonnegative,
        pageCount: nonnegative,
        queryExecutionCount: nonnegative,
        navigationCoverage,
      })
      .strict()
      .optional(),
  })
  .strict()
const sourceHistory = z
  .object({
    evidenceKind: z.literal("referrer_navigation_v1"),
    sourceResource: z.literal("properties/320198532"),
    queryId: z.string().trim().min(1).max(100),
    rangeStart: z.iso.date(),
    rangeEnd: z.iso.date(),
    resultDigest: hex,
    rowCount: nonnegative,
    mappedRows: nonnegative,
    unmappedRows: nonnegative,
    pageCount: nonnegative,
    queryExecutionCount: nonnegative,
    navigationCoverage,
    qualificationDigest: hex,
    status: z.literal("complete"),
  })
  .strict()
export const capacityMeasurement = z
  .object({
    measuredAt: z.string().datetime(),
    clusterSystemId: z.string().regex(/^\d{1,20}$/),
    observedDbBytes: nonnegative,
    availableBytes: nonnegative,
    reserveBytes: nonnegative,
    projectedBytes: nonnegative,
    sampleSourceCount: z.number().int().positive().safe(),
    sampleBytes: z.number().int().positive().safe(),
    source: z.literal("operator_verified_pgdata_df"),
  })
  .strict()
const modelStage = z.enum([
  "source_summary",
  "analytics_query_plan",
  "catalog_discovery",
  "candidate_judgment",
])
const failureCode = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/)
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    protocolVersion: z.literal(2),
    generationId: id,
    modelId: z.string().trim().min(1).max(100),
    promptVersion: z.string().trim().min(1).max(100),
    inputDigest: hex,
    sourceSetDigest: hex,
    inputCutoff: z.string().datetime(),
    expectedSourceCount: nonnegative,
    inputMode: z.enum(["content_only", "historical_analytics"]),
    inputSnapshotMode: z.literal("observed_fenced").optional(),
  }),
  base.extend({
    action: z.literal("manifest"),
    sourceVideoIds: z.array(id).max(20_000),
  }),
  base.extend({ action: z.literal("capacity_probe") }),
  base.extend({
    action: z.literal("capacity"),
    measurement: capacityMeasurement,
  }),
  base.extend({ action: z.literal("claim"), sourceVideoId: id, claimId: id }),
  sourceBase.extend({ action: z.literal("heartbeat") }),
  sourceBase.extend({
    action: z.literal("source_history"),
    history: sourceHistory,
  }),
  base.extend({
    action: z.literal("history_qualification"),
    qualification: gaHistoricalQualification,
  }),
  sourceBase.extend({
    action: z.literal("checkpoint"),
    expectedRevision: nonnegative,
    checkpointId: id,
    checkpoint,
  }),
  sourceBase.extend({ action: z.literal("choice"), choice: provisionalChoice }),
  sourceBase.extend({
    action: z.literal("model_call_start"),
    callId: id,
    stage: modelStage,
    modelId: z.string().trim().min(1).max(100),
    inputDigest: hex,
    startedAt: z.string().datetime(),
  }),
  sourceBase.extend({
    action: z.literal("model_call"),
    callId: id,
    stage: modelStage,
    status: z.enum(["succeeded", "failed"]),
    modelId: z.string().trim().min(1).max(100),
    inputDigest: hex,
    outputDigest: hex.optional(),
    inputTokens: nonnegative.optional(),
    outputTokens: nonnegative.optional(),
    cachedInputTokens: nonnegative.optional(),
    costUsd: money.optional(),
    errorCode: failureCode.optional(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    expectedRevision: nonnegative.optional(),
    checkpointId: id.optional(),
    checkpoint: checkpoint.optional(),
    choice: provisionalChoice.optional(),
  }),
  sourceBase.extend({ action: z.literal("source") }),
  base.extend({
    action: z.literal("fail"),
    sourceVideoId: id.optional(),
    leaseToken: z.uuid().optional(),
    failureCode,
  }),
  base.extend({ action: z.literal("cancel") }),
  base.extend({
    action: z.literal("history_call_start"),
    callId: id,
    sourceVideoId: id.optional(),
    leaseToken: z.uuid().optional(),
    stage: z.enum(["qualification", "snapshot_page", "retry"]),
    requestDigest: hex,
    startedAt: z.string().datetime(),
  }),
  base.extend({
    action: z.literal("history_call"),
    callId: id,
    status: z.enum(["succeeded", "failed"]),
    bytesProcessed: nonnegative.optional(),
    costUsd: money.optional(),
    errorCode: failureCode.optional(),
    finishedAt: z.string().datetime(),
  }),
  base.extend({ action: z.literal("status"), sourceVideoId: id.optional() }),
  z.object({
    action: z.literal("retention_status"),
    protocolVersion: z.literal(2),
    generationId: id,
  }),
  base.extend({ action: z.literal("complete") }),
])

type Tx = Prisma.TransactionClient
type Action = z.infer<typeof actionSchema>
const LEASE_MS = 20 * 60 * 1000
const CAPACITY_MAX_AGE_MS = 30 * 60 * 1000
const MIN_RESERVE_BYTES = 5_000_000_000

function invalid(message: string): never {
  throw new PrecomputedRecommendationError("invalid", message)
}
function conflict(message: string): never {
  throw new PrecomputedRecommendationError("conflict", message)
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
function sameJson(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b
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
  return hash(canonical(a)) === hash(canonical(b))
}
function publicCheckpoint(value: unknown): unknown {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
    ? null
    : value
}
function checkedJson(value: unknown, maxBytes: number): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, "utf8") > maxBytes)
    invalid("Build checkpoint or evidence is oversized")
  return value as Prisma.InputJsonValue
}
function asMoney(value: number | undefined): Prisma.Decimal | null {
  return value === undefined ? null : new Prisma.Decimal(value)
}
function date(value: string): Date {
  return new Date(value)
}

type LockedGeneration = {
  id: string
  status: string
  input_digest: string
  protocol_version: number
  capacity_preflight: unknown
}
async function generationLock(tx: Tx, generationId: string, exclusive = false) {
  const rows = exclusive
    ? await tx.$queryRaw<LockedGeneration[]>`
        SELECT id, status, input_digest, protocol_version, capacity_preflight
        FROM recommendation_precomputed_generation WHERE id = ${generationId} FOR UPDATE`
    : await tx.$queryRaw<LockedGeneration[]>`
        SELECT id, status, input_digest, protocol_version, capacity_preflight
        FROM recommendation_precomputed_generation WHERE id = ${generationId} FOR SHARE`
  const row = rows[0]
  if (!row)
    throw new PrecomputedRecommendationError(
      "not_found",
      "Generation not found",
    )
  if (row.protocol_version !== 2)
    conflict("Generation uses a different build protocol")
  return row
}
function requireCapacityFresh(generation: LockedGeneration): void {
  const capacity = generation.capacity_preflight as {
    status?: string
    measuredAt?: string
  } | null
  if (!capacity || capacity.status !== "passed")
    conflict("Measured capacity preflight is required")
  const age = Date.now() - Date.parse(capacity.measuredAt ?? "")
  if (!Number.isFinite(age) || age < -60_000 || age > CAPACITY_MAX_AGE_MS)
    throw new PrecomputedRecommendationError(
      "capacity_attestation_expired",
      "Capacity attestation expired; refresh before more work",
    )
}
async function reserveBudget(
  tx: Tx,
  generationId: string,
  estimatedBytes: number,
) {
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0)
    invalid("Invalid build write size")
  const updated = await tx.$queryRaw<Array<{ consumed_bytes: bigint }>>`
    UPDATE recommendation_precomputed_build_budget b
    SET consumed_bytes = consumed_bytes + ${BigInt(estimatedBytes)}
    FROM recommendation_precomputed_generation g
    WHERE b.generation_id = ${generationId} AND g.id = b.generation_id
      AND g.capacity_preflight->>'status' = 'passed'
      AND b.consumed_bytes + ${BigInt(estimatedBytes)} <= (g.capacity_preflight->>'projectedBytes')::bigint
    RETURNING b.consumed_bytes`
  if (!updated[0])
    throw new PrecomputedRecommendationError(
      "capacity_budget_exceeded",
      "Measured build storage budget exhausted; refresh capacity before more work",
    )
  return Number(updated[0].consumed_bytes)
}

async function checkedGeneration(
  tx: Tx,
  input: { generationId: string; generationInputDigest: string },
  exclusive = false,
) {
  const row = await generationLock(tx, input.generationId, exclusive)
  if (row.input_digest !== input.generationInputDigest)
    conflict("Generation input digest differs")
  return row
}

async function sourceLock(tx: Tx, generationId: string, sourceVideoId: string) {
  const rows = await tx.$queryRaw<
    Array<{
      state: string
      lease_token: string | null
      lease_expires_at: Date | null
      claim_id: string | null
      checkpoint_revision: number
      checkpoint_id: string | null
      checkpoint_digest: string | null
    }>
  >`
    SELECT state, lease_token, lease_expires_at, claim_id,
           checkpoint_revision, checkpoint_id, checkpoint_digest
    FROM recommendation_precomputed_build_source
    WHERE generation_id = ${generationId} AND source_video_id = ${sourceVideoId}
    FOR UPDATE`
  if (!rows[0])
    throw new PrecomputedRecommendationError(
      "not_found",
      "Source not in generation manifest",
    )
  return rows[0]
}
function leaseCurrent(
  row: Awaited<ReturnType<typeof sourceLock>>,
  token: string,
) {
  return (
    row.state === "claimed" &&
    row.lease_token === token &&
    row.lease_expires_at !== null &&
    row.lease_expires_at.getTime() > Date.now()
  )
}
function requireLease(
  row: Awaited<ReturnType<typeof sourceLock>>,
  token: string,
): void {
  if (!leaseCurrent(row, token)) conflict("Source lease is stale or expired")
}

async function probe(tx: Tx) {
  const [row] = await tx.$queryRaw<
    Array<{ observed_db_bytes: bigint; cluster_system_id: string }>
  >`
    SELECT pg_database_size(current_database())::bigint AS observed_db_bytes,
           (SELECT system_identifier::text FROM pg_control_system()) AS cluster_system_id`
  if (!row?.cluster_system_id)
    conflict("PostgreSQL capacity identity unavailable")
  return {
    observedDbBytes: Number(row.observed_db_bytes),
    clusterSystemId: row.cluster_system_id,
    availableBytes: null,
  }
}

async function usage(prisma: PrismaClient | Tx, generationId: string) {
  const [models] = await prisma.$queryRaw<
    Array<{
      calls: bigint
      pending: bigint
      unknown_cost: bigint
      known_cost_usd: string
      input_tokens: bigint
      output_tokens: bigint
      cached_input_tokens: bigint
    }>
  >`
    SELECT count(*)::bigint AS calls,
           count(*) FILTER (WHERE status = 'pending')::bigint AS pending,
           count(*) FILTER (WHERE cost_usd IS NULL)::bigint AS unknown_cost,
           COALESCE(sum(cost_usd), 0)::text AS known_cost_usd,
           COALESCE(sum(input_tokens), 0)::bigint AS input_tokens,
           COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
           COALESCE(sum(cached_input_tokens), 0)::bigint AS cached_input_tokens
    FROM recommendation_precomputed_model_call WHERE generation_id = ${generationId}`
  const [history] = await prisma.$queryRaw<
    Array<{
      calls: bigint
      pending: bigint
      unknown_cost: bigint
      unknown_bytes: bigint
      known_cost_usd: string
      known_bytes: bigint
    }>
  >`
    SELECT count(*)::bigint AS calls,
           count(*) FILTER (WHERE status = 'pending')::bigint AS pending,
           count(*) FILTER (WHERE cost_usd IS NULL)::bigint AS unknown_cost,
           count(*) FILTER (WHERE bytes_processed IS NULL)::bigint AS unknown_bytes,
           COALESCE(sum(cost_usd), 0)::text AS known_cost_usd,
           COALESCE(sum(bytes_processed), 0)::bigint AS known_bytes
    FROM recommendation_precomputed_history_call WHERE generation_id = ${generationId}`
  return {
    modelCallCount: Number(models.calls),
    modelPendingCount: Number(models.pending),
    modelUnknownCostCount: Number(models.unknown_cost),
    modelKnownCostUsd: Number(models.known_cost_usd),
    inputTokens: Number(models.input_tokens),
    outputTokens: Number(models.output_tokens),
    cachedInputTokens: Number(models.cached_input_tokens),
    historyCallCount: Number(history.calls),
    historyPendingCount: Number(history.pending),
    historyUnknownBytesCount: Number(history.unknown_bytes),
    historyKnownBytes: Number(history.known_bytes),
    historyUnknownCostCount: Number(history.unknown_cost),
    historyKnownCostUsd: Number(history.known_cost_usd),
  }
}

export async function submitDurablePrecomputedRecommendation(
  prisma: PrismaClient,
  raw: unknown,
  authorizationHeader: string | null,
): Promise<Record<string, unknown>> {
  if (!isValidMastraRecommendationIngestBearer(authorizationHeader))
    throw new PrecomputedRecommendationError(
      "unauthorized",
      "Authorization required",
    )
  const parsed = actionSchema.safeParse(raw)
  if (!parsed.success) invalid("Invalid durable build payload")
  const input: Action = parsed.data
  if (input.action === "start") {
    return prisma.$transaction(async (tx) => {
      const inserted = await tx.recommendationPrecomputedGeneration.createMany({
        data: [
          {
            id: input.generationId,
            modelId: input.modelId,
            promptVersion: input.promptVersion,
            inputDigest: input.inputDigest,
            sourceSetDigest: input.sourceSetDigest,
            inputCutoff: date(input.inputCutoff),
            expectedSourceCount: input.expectedSourceCount,
            inputMode: input.inputMode,
            inputSnapshotMode: "observed_fenced",
            protocolVersion: 2,
          },
        ],
        skipDuplicates: true,
      })
      // Read the bounded retirement proof after
      // the unique-key insert: a concurrent retirement blocks that insert until
      // its proof and deletion commit, so the receipt cannot be reused.
      const retired =
        await tx.recommendationPrecomputedGenerationRetentionProof.findUnique({
          where: { generationId: input.generationId },
        })
      if (retired) conflict("Generation ID was retired")
      const existing =
        await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: input.generationId },
        })
      if (
        existing.protocolVersion !== 2 ||
        existing.modelId !== input.modelId ||
        existing.promptVersion !== input.promptVersion ||
        existing.inputDigest !== input.inputDigest ||
        existing.sourceSetDigest !== input.sourceSetDigest ||
        existing.inputCutoff.getTime() !== date(input.inputCutoff).getTime() ||
        existing.expectedSourceCount !== input.expectedSourceCount ||
        existing.inputMode !== input.inputMode ||
        existing.inputSnapshotMode !== "observed_fenced"
      )
        conflict("Generation identity has different input")
      return {
        generationId: existing.id,
        state: existing.status,
        replay: inserted.count === 0,
      }
    })
  }
  if (input.action === "capacity_probe") {
    return prisma.$transaction(async (tx) => {
      await checkedGeneration(tx, input)
      return probe(tx)
    })
  }
  if (input.action === "retention_status") {
    const generation =
      await prisma.recommendationPrecomputedGeneration.findUnique({
        where: { id: input.generationId },
        select: {
          id: true,
          protocolVersion: true,
          inputCutoff: true,
          inputDigest: true,
          inputMode: true,
          status: true,
        },
      })
    if (generation)
      return {
        generationId: generation.id,
        protocolVersion: 2,
        generationProtocolVersion: generation.protocolVersion,
        inputCutoff: generation.inputCutoff.toISOString(),
        inputDigest: generation.inputDigest,
        inputMode: generation.inputMode,
        state: generation.status,
        sourceWorkResumable: ["incomplete", "capacity_blocked"].includes(
          generation.status,
        ),
      }
    const proof =
      await prisma.recommendationPrecomputedGenerationRetentionProof.findUnique(
        {
          where: { generationId: input.generationId },
        },
      )
    if (!proof || proof.expiresAt <= new Date())
      throw new PrecomputedRecommendationError(
        "not_found",
        "Generation not found",
      )
    return {
      generationId: proof.generationId,
      protocolVersion: 2,
      generationProtocolVersion: proof.generationProtocolVersion,
      inputCutoff: proof.inputCutoff.toISOString(),
      inputDigest: proof.inputDigest,
      inputMode: proof.inputMode,
      state: proof.state,
      sourceWorkResumable: false,
    }
  }
  if (input.action === "status") {
    const generation =
      await prisma.recommendationPrecomputedGeneration.findUnique({
        where: { id: input.generationId },
      })
    if (!generation)
      throw new PrecomputedRecommendationError(
        "not_found",
        "Generation not found",
      )
    if (
      generation.protocolVersion !== 2 ||
      generation.inputDigest !== input.generationInputDigest
    )
      conflict("Generation input digest differs")
    const identity = {
      generationId: generation.id,
      protocolVersion: 2,
      inputDigest: generation.inputDigest,
      inputCutoff: generation.inputCutoff.toISOString(),
      sourceWorkResumable: ["incomplete", "capacity_blocked"].includes(
        generation.status,
      ),
    }
    // A retiring generation drains children in bounded pages. Do not expose
    // those partial rows as a complete source/usage report during reclamation.
    if (generation.status === "retiring")
      return { ...identity, state: "retiring", detailsUnavailable: true }
    const [counts, source, usageReport, accepted, budget, finalSource] =
      await Promise.all([
        prisma.recommendationPrecomputedBuildSource.groupBy({
          by: ["state"],
          where: { generationId: input.generationId },
          _count: true,
        }),
        input.sourceVideoId
          ? prisma.recommendationPrecomputedBuildSource.findUnique({
              where: {
                generationId_sourceVideoId: {
                  generationId: input.generationId,
                  sourceVideoId: input.sourceVideoId,
                },
              },
            })
          : null,
        usage(prisma, input.generationId),
        prisma.recommendationPrecomputedSource.aggregate({
          where: { generationId: input.generationId },
          _sum: { acceptedCount: true },
        }),
        prisma.recommendationPrecomputedBuildBudget.findUnique({
          where: { generationId: input.generationId },
        }),
        input.sourceVideoId
          ? prisma.recommendationPrecomputedSource.findUnique({
              where: {
                generationId_sourceVideoId: {
                  generationId: input.generationId,
                  sourceVideoId: input.sourceVideoId,
                },
              },
              select: { acceptedCount: true },
            })
          : null,
      ])
    const count = (state: string) =>
      counts.find((row) => row.state === state)?._count ?? 0
    return {
      ...identity,
      state: generation.status,
      failureCode: generation.failureCode,
      expectedSourceCount: generation.expectedSourceCount,
      manifestCommitted: generation.manifestCommittedAt !== null,
      pendingSourceCount: count("pending"),
      claimedSourceCount: count("claimed"),
      completeEdgesSourceCount: count("complete_edges"),
      completeEmptySourceCount: count("complete_empty"),
      failedSourceCount: count("failed"),
      acceptedCount: accepted._sum.acceptedCount ?? 0,
      capacity: generation.capacityPreflight,
      capacityFresh: (() => {
        const current = generation.capacityPreflight as {
          status?: string
          measuredAt?: string
        } | null
        return (
          current?.status === "passed" &&
          Number.isFinite(Date.parse(current.measuredAt ?? "")) &&
          Date.now() - Date.parse(current.measuredAt ?? "") <=
            CAPACITY_MAX_AGE_MS
        )
      })(),
      capacityEstimatedConsumedBytes: Number(budget?.consumedBytes ?? 0n),
      elapsedMs:
        (
          generation.completedAt ??
          generation.failedAt ??
          generation.cancelledAt ??
          new Date()
        ).getTime() - generation.createdAt.getTime(),
      usage: usageReport,
      source: source
        ? {
            state: source.state,
            attemptNumber: source.attemptNumber,
            checkpointRevision: source.checkpointRevision,
            checkpoint: publicCheckpoint(source.checkpoint),
            historicalProvenance: source.historicalProvenance,
            acceptedCount:
              finalSource?.acceptedCount ??
              (await prisma.recommendationPrecomputedBuildChoice.count({
                where: {
                  generationId: input.generationId,
                  sourceVideoId: input.sourceVideoId,
                },
              })),
            failureCode: source.failureCode,
          }
        : null,
    }
  }
  return prisma.$transaction(async (tx) => mutate(tx, input), {
    timeout: 30_000,
  })
}

async function storedSize(prisma: PrismaClient | Tx, generationId: string) {
  const [row] = await prisma.$queryRaw<
    Array<{ generation_row_bytes: bigint; tables_physical_bytes: bigint }>
  >`
    SELECT (
      (SELECT COALESCE(sum(pg_column_size(t)), 0) FROM recommendation_precomputed_generation t WHERE id = ${generationId}) +
      (SELECT COALESCE(sum(pg_column_size(t)), 0) FROM recommendation_precomputed_build_source t WHERE generation_id = ${generationId}) +
      (SELECT COALESCE(sum(pg_column_size(t)), 0) FROM recommendation_precomputed_build_choice t WHERE generation_id = ${generationId}) +
      (SELECT COALESCE(sum(pg_column_size(t)), 0) FROM recommendation_precomputed_source t WHERE generation_id = ${generationId}) +
      (SELECT COALESCE(sum(pg_column_size(t)), 0) FROM recommendation_precomputed_model_call t WHERE generation_id = ${generationId}) +
      (SELECT COALESCE(sum(pg_column_size(t)), 0) FROM recommendation_precomputed_history_call t WHERE generation_id = ${generationId}) +
      (SELECT COALESCE(sum(pg_column_size(t)), 0) FROM recommendation_precomputed_build_budget t WHERE generation_id = ${generationId})
    )::bigint AS generation_row_bytes,
    (
      pg_total_relation_size('recommendation_precomputed_generation') +
      pg_total_relation_size('recommendation_precomputed_build_source') +
      pg_total_relation_size('recommendation_precomputed_build_choice') +
      pg_total_relation_size('recommendation_precomputed_source') +
      pg_total_relation_size('recommendation_precomputed_model_call') +
      pg_total_relation_size('recommendation_precomputed_history_call') +
      pg_total_relation_size('recommendation_precomputed_build_budget')
    )::bigint AS tables_physical_bytes`
  return {
    generationRowBytes: Number(row.generation_row_bytes),
    tablesPhysicalBytesAllGenerations: Number(row.tables_physical_bytes),
  }
}

/** Private Admin report; no public Watch read or activation authority. */
export async function loadDurablePrecomputedBuildReport(
  prisma: PrismaClient,
  input: {
    generationId: string
    sourceVideoId?: string
    reviewer: Principal | null
  },
) {
  if (
    !hasPermission(input.reviewer, "read:recommendation-aggregates") ||
    !hasPermission(input.reviewer, "read:recommendation-traces")
  )
    throw new PrecomputedRecommendationError(
      "unauthorized",
      "Admin review permission required",
    )
  const generation =
    await prisma.recommendationPrecomputedGeneration.findUnique({
      where: { id: input.generationId },
    })
  if (
    !generation ||
    generation.protocolVersion !== 2 ||
    generation.status === "retiring"
  )
    return null
  const [
    counts,
    failures,
    source,
    knownUsage,
    size,
    budget,
    historyTotals,
    accepted,
  ] = await Promise.all([
    prisma.recommendationPrecomputedBuildSource.groupBy({
      by: ["state"],
      where: { generationId: input.generationId },
      _count: true,
    }),
    prisma.recommendationPrecomputedBuildSource.groupBy({
      by: ["failureCode"],
      where: { generationId: input.generationId, state: "failed" },
      _count: true,
    }),
    input.sourceVideoId
      ? prisma.recommendationPrecomputedBuildSource.findUnique({
          where: {
            generationId_sourceVideoId: {
              generationId: input.generationId,
              sourceVideoId: input.sourceVideoId,
            },
          },
        })
      : null,
    usage(prisma, input.generationId),
    storedSize(prisma, input.generationId),
    prisma.recommendationPrecomputedBuildBudget.findUnique({
      where: { generationId: input.generationId },
    }),
    prisma.$queryRaw<
      Array<{
        source_count: bigint
        rows: bigint
        mapped: bigint
        unmapped: bigint
        pages: bigint
        queries: bigint
        candidate_events: bigint
        qualified_events: bigint
        home_events: bigint
        self_events: bigint
        cross_host_events: bigint
        malformed_events: bigint
        unmapped_events: bigint
        ambiguous_events: bigint
      }>
    >`
      SELECT count(historical_provenance)::bigint AS source_count,
             COALESCE(sum((historical_provenance->>'rowCount')::bigint), 0)::bigint AS rows,
             COALESCE(sum((historical_provenance->>'mappedRows')::bigint), 0)::bigint AS mapped,
             COALESCE(sum((historical_provenance->>'unmappedRows')::bigint), 0)::bigint AS unmapped,
             COALESCE(sum((historical_provenance->>'pageCount')::bigint), 0)::bigint AS pages,
             COALESCE(sum((historical_provenance->>'queryExecutionCount')::bigint), 0)::bigint AS queries,
             COALESCE(sum((historical_provenance->'navigationCoverage'->>'candidateEvents')::bigint), 0)::bigint AS candidate_events,
             COALESCE(sum((historical_provenance->'navigationCoverage'->>'qualifiedEvents')::bigint), 0)::bigint AS qualified_events,
             COALESCE(sum((historical_provenance->'navigationCoverage'->>'homeEvents')::bigint), 0)::bigint AS home_events,
             COALESCE(sum((historical_provenance->'navigationCoverage'->>'selfEvents')::bigint), 0)::bigint AS self_events,
             COALESCE(sum((historical_provenance->'navigationCoverage'->>'crossHostEvents')::bigint), 0)::bigint AS cross_host_events,
             COALESCE(sum((historical_provenance->'navigationCoverage'->>'malformedEvents')::bigint), 0)::bigint AS malformed_events,
             COALESCE(sum((historical_provenance->'navigationCoverage'->>'unmappedEvents')::bigint), 0)::bigint AS unmapped_events,
             COALESCE(sum((historical_provenance->'navigationCoverage'->>'ambiguousEvents')::bigint), 0)::bigint AS ambiguous_events
      FROM recommendation_precomputed_build_source WHERE generation_id = ${input.generationId}`,
    prisma.recommendationPrecomputedSource.aggregate({
      where: { generationId: input.generationId, status: "complete" },
      _sum: { acceptedCount: true },
    }),
  ])
  const count = (state: string) =>
    counts.find((item) => item.state === state)?._count ?? 0
  const finishedSources = count("complete_edges") + count("complete_empty")
  const elapsedMs =
    (
      generation.completedAt ??
      generation.failedAt ??
      generation.cancelledAt ??
      new Date()
    ).getTime() - generation.createdAt.getTime()
  const costEstimate =
    finishedSources >= 10 && knownUsage.modelUnknownCostCount === 0
      ? (knownUsage.modelKnownCostUsd * generation.expectedSourceCount) /
        finishedSources
      : null
  const capacity = generation.capacityPreflight as {
    measuredAt?: string
    status?: string
  } | null
  return {
    generationId: generation.id,
    state: generation.status,
    failureCode: generation.failureCode,
    modelId: generation.modelId,
    promptVersion: generation.promptVersion,
    inputMode: generation.inputMode,
    inputCutoff: generation.inputCutoff,
    expectedSourceCount: generation.expectedSourceCount,
    manifestCommitted: generation.manifestCommittedAt !== null,
    pendingSourceCount: count("pending"),
    claimedSourceCount: count("claimed"),
    completeEdgesSourceCount: count("complete_edges"),
    completeEmptySourceCount: count("complete_empty"),
    failedSourceCount: count("failed"),
    acceptedCount: accepted._sum.acceptedCount ?? 0,
    failures: failures.map((item) => ({
      code: item.failureCode ?? "unknown",
      count: item._count,
    })),
    capacity: generation.capacityPreflight,
    capacityFresh:
      capacity?.status === "passed" &&
      Date.now() - Date.parse(capacity.measuredAt ?? "") <= CAPACITY_MAX_AGE_MS,
    capacityEstimatedConsumedBytes: Number(budget?.consumedBytes ?? 0n),
    usage: knownUsage,
    storedSize: size,
    elapsedMs,
    projectedElapsedMs:
      finishedSources >= 10
        ? (elapsedMs * generation.expectedSourceCount) / finishedSources
        : null,
    projectedKnownModelUsd: costEstimate,
    historicalQualification: generation.historicalQualification
      ? gaHistoricalQualification.parse(generation.historicalQualification)
      : null,
    historyTotals: {
      sourceCount: Number(historyTotals[0]?.source_count ?? 0n),
      rowCount: Number(historyTotals[0]?.rows ?? 0n),
      mappedRows: Number(historyTotals[0]?.mapped ?? 0n),
      unmappedRows: Number(historyTotals[0]?.unmapped ?? 0n),
      pageCount: Number(historyTotals[0]?.pages ?? 0n),
      queryExecutionCount: Number(historyTotals[0]?.queries ?? 0n),
      navigationCoverage:
        Number(historyTotals[0]?.source_count ?? 0n) > 0
          ? {
              candidateEvents: Number(historyTotals[0]?.candidate_events ?? 0n),
              qualifiedEvents: Number(historyTotals[0]?.qualified_events ?? 0n),
              homeEvents: Number(historyTotals[0]?.home_events ?? 0n),
              selfEvents: Number(historyTotals[0]?.self_events ?? 0n),
              crossHostEvents: Number(
                historyTotals[0]?.cross_host_events ?? 0n,
              ),
              malformedEvents: Number(historyTotals[0]?.malformed_events ?? 0n),
              unmappedEvents: Number(historyTotals[0]?.unmapped_events ?? 0n),
              ambiguousEvents: Number(historyTotals[0]?.ambiguous_events ?? 0n),
            }
          : null,
    },
    source: source
      ? {
          id: source.sourceVideoId,
          state: source.state,
          attemptNumber: source.attemptNumber,
          checkpointRevision: source.checkpointRevision,
          historicalProvenance: source.historicalProvenance
            ? sourceHistory.parse(source.historicalProvenance)
            : null,
          failureCode: source.failureCode,
        }
      : null,
  }
}

async function saveCheckpoint(
  tx: Tx,
  input: {
    generationId: string
    sourceVideoId: string
    expectedRevision: number
    checkpointId: string
    checkpoint: z.infer<typeof checkpoint>
  },
  source: Awaited<ReturnType<typeof sourceLock>>,
  reserve = true,
) {
  const checkpointDigest = hash(input.checkpoint)
  if (source.checkpoint_id === input.checkpointId) {
    if (source.checkpoint_digest !== checkpointDigest)
      conflict("Checkpoint retry differs")
    return { replay: true, checkpointRevision: source.checkpoint_revision }
  }
  if (source.checkpoint_revision !== input.expectedRevision)
    conflict("Checkpoint revision is stale")
  if (reserve)
    await reserveBudget(
      tx,
      input.generationId,
      Buffer.byteLength(JSON.stringify(input.checkpoint), "utf8") + 128,
    )
  const next = source.checkpoint_revision + 1
  await tx.recommendationPrecomputedBuildSource.update({
    where: {
      generationId_sourceVideoId: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
      },
    },
    data: {
      checkpoint: checkedJson(input.checkpoint, 16_000),
      checkpointRevision: next,
      checkpointId: input.checkpointId,
      checkpointDigest,
    },
  })
  return { replay: false, checkpointRevision: next }
}

async function saveChoice(
  tx: Tx,
  generationId: string,
  sourceVideoId: string,
  choice: z.infer<typeof provisionalChoice>,
  reserve = true,
) {
  const submissionDigest = hash(choice)
  const existing = await tx.recommendationPrecomputedBuildChoice.findUnique({
    where: {
      generationId_sourceVideoId_targetVideoId: {
        generationId,
        sourceVideoId,
        targetVideoId: choice.targetVideoId,
      },
    },
  })
  if (existing) {
    if (existing.submissionDigest !== submissionDigest)
      conflict("Provisional choice retry differs")
    return true
  }
  if (reserve)
    await reserveBudget(
      tx,
      generationId,
      Buffer.byteLength(JSON.stringify(choice), "utf8") + 128,
    )
  await tx.recommendationPrecomputedBuildChoice.create({
    data: {
      generationId,
      sourceVideoId,
      targetVideoId: choice.targetVideoId,
      payload: checkedJson(choice, 8_000),
      submissionDigest,
    },
  })
  return false
}

async function mutate(
  tx: Tx,
  input: Exclude<
    Action,
    { action: "start" | "capacity_probe" | "status" | "retention_status" }
  >,
): Promise<Record<string, unknown>> {
  const exclusive =
    [
      "manifest",
      "capacity",
      "history_qualification",
      "complete",
      "cancel",
    ].includes(input.action) ||
    (input.action === "fail" && !input.sourceVideoId)
  const generation = await checkedGeneration(tx, input, exclusive)
  if (
    [
      "claim",
      "checkpoint",
      "choice",
      "source_history",
      "model_call_start",
      "history_call_start",
      "source",
    ].includes(input.action)
  )
    requireCapacityFresh(generation)
  if (input.action === "manifest") {
    const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow(
      { where: { id: input.generationId } },
    )
    const ids = input.sourceVideoIds
    if (
      ids.length !== meta.expectedSourceCount ||
      new Set(ids).size !== ids.length ||
      hash([...ids].sort()) !== meta.sourceSetDigest
    )
      invalid("Manifest source set does not match generation")
    if (meta.manifestCommittedAt) {
      return {
        generationId: meta.id,
        state: meta.status,
        replay: true,
        pendingSourceCount: await tx.recommendationPrecomputedBuildSource.count(
          { where: { generationId: meta.id, state: "pending" } },
        ),
      }
    }
    if (generation.status !== "incomplete") conflict("Generation is closed")
    await tx.recommendationPrecomputedBuildSource.createMany({
      data: ids.map((sourceVideoId) => ({
        generationId: meta.id,
        sourceVideoId,
      })),
    })
    await tx.recommendationPrecomputedGeneration.update({
      where: { id: meta.id },
      data: { manifestCommittedAt: new Date() },
    })
    await tx.recommendationPrecomputedBuildBudget.upsert({
      where: { generationId: meta.id },
      create: { generationId: meta.id, consumedBytes: 0n },
      update: { consumedBytes: 0n },
    })
    return {
      generationId: meta.id,
      state: meta.status,
      replay: false,
      pendingSourceCount: ids.length,
    }
  }
  if (input.action === "history_qualification") {
    if (generation.status !== "incomplete") conflict("Generation is closed")
    const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow(
      { where: { id: input.generationId } },
    )
    if (meta.inputMode !== "historical_analytics")
      invalid("Generation does not use historical inputs")
    const qualificationDigest = hash(input.qualification)
    if (meta.historicalQualification) {
      if (!sameJson(meta.historicalQualification, input.qualification))
        conflict("History qualification retry differs")
      return {
        generationId: input.generationId,
        qualificationDigest: meta.historicalQualificationDigest,
        replay: true,
      }
    }
    await tx.recommendationPrecomputedGeneration.update({
      where: { id: input.generationId },
      data: {
        historicalQualification: checkedJson(input.qualification, 8_000),
        historicalQualificationDigest: qualificationDigest,
      },
    })
    return {
      generationId: input.generationId,
      qualificationDigest,
      replay: false,
    }
  }
  if (input.action === "capacity") {
    const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow(
      { where: { id: input.generationId } },
    )
    if (!meta.manifestCommittedAt) conflict("Manifest is not committed")
    if (!["incomplete", "capacity_blocked"].includes(generation.status))
      conflict("Generation is closed")
    const measurement = input.measurement
    const previous = meta.capacityPreflight as
      | ({ status?: string } & Record<string, unknown>)
      | null
    const previousMeasurement = previous
      ? Object.fromEntries(
          Object.entries(previous).filter(
            ([key]) =>
              ![
                "status",
                "otherReservedBytes",
                "observedDbGrowthBytes",
                "recentTerminalProjectedBytes",
                "unaccountedGrowthBytes",
                "heldProjectionBytes",
                "blockedAt",
                "lastPassedAt",
              ].includes(key),
          ),
        )
      : null
    if (
      previous?.status === "passed" &&
      sameJson(previousMeasurement, measurement)
    )
      return {
        generationId: meta.id,
        state: "incomplete",
        replay: true,
        capacity: meta.capacityPreflight,
      }
    if (
      previous?.status === "insufficient" &&
      sameJson(previousMeasurement, measurement)
    )
      return {
        generationId: meta.id,
        state: "capacity_blocked",
        replay: true,
        capacity: meta.capacityPreflight,
      }
    const measuredAt = date(measurement.measuredAt).getTime()
    if (
      measuredAt > Date.now() ||
      Date.now() - measuredAt > CAPACITY_MAX_AGE_MS
    )
      invalid("Capacity observation is stale")
    // Admissions share this lock. A build may finish without taking it, so a
    // reservation is retained below until the operator's sample postdates its
    // terminal write.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('recommendation_precomputed_build_capacity'))::text AS held`
    const observed = await probe(tx)
    if (observed.clusterSystemId !== measurement.clusterSystemId)
      conflict("Capacity observation belongs to a different PostgreSQL cluster")
    if (
      Math.abs(observed.observedDbBytes - measurement.observedDbBytes) >
      Math.max(256_000_000, observed.observedDbBytes * 0.02)
    )
      conflict("Capacity observation no longer matches database size")
    if (measurement.reserveBytes < MIN_RESERVE_BYTES)
      invalid("Capacity reserve is below the conservative implementation floor")
    const sampleFloor = Math.ceil(
      (2 * measurement.sampleBytes * meta.expectedSourceCount) /
        measurement.sampleSourceCount,
    )
    if (measurement.projectedBytes < sampleFloor)
      invalid("Projection is below twice the measured sample extrapolation")
    const [newerAdmission] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM recommendation_precomputed_generation
      WHERE id <> ${input.generationId} AND protocol_version = 2
        AND (capacity_preflight->>'lastPassedAt')::timestamptz >= ${date(measurement.measuredAt)}
      LIMIT 1`
    if (newerAdmission)
      conflict(
        "Capacity observation predates another build's capacity admission",
      )
    const [other] = await tx.$queryRaw<
      Array<{ active_bytes: bigint; recent_terminal_bytes: bigint }>
    >`
      SELECT
        COALESCE(sum(GREATEST(
          COALESCE((capacity_preflight->>'heldProjectionBytes')::bigint, 0),
          (capacity_preflight->>'projectedBytes')::bigint
        )) FILTER (
          WHERE (status = 'incomplete' AND capacity_preflight->>'status' = 'passed')
            OR (status = 'capacity_blocked'
              AND (capacity_preflight->>'heldProjectionBytes')::bigint > 0
              AND (capacity_preflight->>'blockedAt')::timestamptz >= ${date(measurement.measuredAt)})
        ), 0)::bigint AS active_bytes,
        COALESCE(sum(GREATEST(
          COALESCE((capacity_preflight->>'heldProjectionBytes')::bigint, 0),
          (capacity_preflight->>'projectedBytes')::bigint
        )) FILTER (
          WHERE status IN ('complete', 'failed', 'cancelled')
            AND COALESCE(completed_at, failed_at, cancelled_at) >= ${date(measurement.measuredAt)}
        ), 0)::bigint AS recent_terminal_bytes
      FROM recommendation_precomputed_generation
      WHERE id <> ${input.generationId}
        AND protocol_version = 2
        AND capacity_preflight->>'projectedBytes' IS NOT NULL`
    const reservedBytes = Number(other.active_bytes)
    const recentTerminalProjectedBytes = Number(other.recent_terminal_bytes)
    const observedDbGrowthBytes = Math.max(
      0,
      observed.observedDbBytes - measurement.observedDbBytes,
    )
    // Physical database growth can overlap a terminal build's projection.
    // Taking the larger of the two avoids charging it twice while covering
    // storage outside the database (including WAL) that pg_database_size omits.
    const unaccountedGrowthBytes = Math.max(
      observedDbGrowthBytes,
      recentTerminalProjectedBytes,
    )
    const status =
      measurement.availableBytes -
        measurement.reserveBytes -
        reservedBytes -
        unaccountedGrowthBytes >=
      measurement.projectedBytes
        ? "passed"
        : "insufficient"
    const capacity = {
      ...measurement,
      status,
      // Preserve the largest admitted projection across refreshes. A later
      // insufficient attestation cannot erase writes made under an old pass.
      heldProjectionBytes: Math.max(
        Number(previous?.heldProjectionBytes ?? 0),
        previous?.status === "passed"
          ? Number(previous.projectedBytes ?? 0)
          : 0,
        status === "passed" ? measurement.projectedBytes : 0,
      ),
      lastPassedAt:
        status === "passed"
          ? new Date().toISOString()
          : (previous?.lastPassedAt ?? null),
      blockedAt: status === "insufficient" ? new Date().toISOString() : null,
      otherReservedBytes: reservedBytes,
      observedDbGrowthBytes,
      recentTerminalProjectedBytes,
      unaccountedGrowthBytes,
    }
    await tx.recommendationPrecomputedGeneration.update({
      where: { id: meta.id },
      data: {
        capacityPreflight: capacity,
        status: status === "passed" ? "incomplete" : "capacity_blocked",
      },
    })
    if (status === "passed")
      await tx.recommendationPrecomputedBuildBudget.update({
        where: { generationId: meta.id },
        data: { consumedBytes: 0n },
      })
    return {
      generationId: meta.id,
      state: status === "passed" ? "incomplete" : "capacity_blocked",
      replay: false,
      capacity,
    }
  }
  if (input.action === "claim") {
    if (generation.status !== "incomplete")
      conflict("Generation is not claimable")
    const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow(
      { where: { id: input.generationId } },
    )
    if (
      !meta.manifestCommittedAt ||
      !meta.capacityPreflight ||
      (meta.capacityPreflight as { status?: string }).status !== "passed"
    )
      conflict("Measured capacity preflight is required")
    const row = await sourceLock(tx, input.generationId, input.sourceVideoId)
    if (["complete_edges", "complete_empty", "failed"].includes(row.state))
      return {
        generationId: input.generationId,
        sourceState: row.state,
        leaseToken: null,
        replay: true,
      }
    if (
      row.state === "claimed" &&
      row.lease_expires_at &&
      row.lease_expires_at.getTime() > Date.now()
    ) {
      if (row.claim_id !== input.claimId) conflict("Source has a live claim")
      const current =
        await tx.recommendationPrecomputedBuildSource.findUniqueOrThrow({
          where: {
            generationId_sourceVideoId: {
              generationId: input.generationId,
              sourceVideoId: input.sourceVideoId,
            },
          },
        })
      return {
        generationId: input.generationId,
        sourceState: current.state,
        leaseToken: current.leaseToken,
        leaseExpiresAt: current.leaseExpiresAt?.toISOString(),
        attemptNumber: current.attemptNumber,
        checkpointRevision: current.checkpointRevision,
        checkpoint: publicCheckpoint(current.checkpoint),
        historicalProvenance: current.historicalProvenance,
        replay: true,
      }
    }
    const leaseToken = randomUUID()
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS)
    const current = await tx.recommendationPrecomputedBuildSource.update({
      where: {
        generationId_sourceVideoId: {
          generationId: input.generationId,
          sourceVideoId: input.sourceVideoId,
        },
      },
      data: {
        state: "claimed",
        claimId: input.claimId,
        leaseToken,
        leaseExpiresAt,
        attemptNumber: { increment: 1 },
      },
    })
    return {
      generationId: input.generationId,
      sourceState: "claimed",
      leaseToken,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      attemptNumber: current.attemptNumber,
      checkpointRevision: current.checkpointRevision,
      checkpoint: publicCheckpoint(current.checkpoint),
      historicalProvenance: current.historicalProvenance,
      replay: false,
    }
  }
  if (input.action === "cancel") {
    if (generation.status === "cancelled")
      return {
        generationId: input.generationId,
        state: "cancelled",
        replay: true,
      }
    if (generation.status === "complete")
      conflict("Complete generation cannot be cancelled")
    if (generation.status === "failed")
      conflict("Failed generation cannot be cancelled")
    await tx.recommendationPrecomputedGeneration.update({
      where: { id: input.generationId },
      data: { status: "cancelled", cancelledAt: new Date() },
    })
    return {
      generationId: input.generationId,
      state: "cancelled",
      replay: false,
    }
  }
  if (
    input.action === "heartbeat" ||
    input.action === "checkpoint" ||
    input.action === "choice" ||
    input.action === "source_history"
  ) {
    if (generation.status !== "incomplete") conflict("Generation is closed")
    const row = await sourceLock(tx, input.generationId, input.sourceVideoId)
    requireLease(row, input.leaseToken)
    if (input.action === "heartbeat") {
      const leaseExpiresAt = new Date(Date.now() + LEASE_MS)
      await tx.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: input.generationId,
            sourceVideoId: input.sourceVideoId,
          },
        },
        data: { leaseExpiresAt },
      })
      return {
        generationId: input.generationId,
        sourceState: "claimed",
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      }
    }
    if (input.action === "checkpoint") {
      const result = await saveCheckpoint(tx, input, row)
      return { generationId: input.generationId, ...result }
    }
    if (input.action === "choice") {
      const replay = await saveChoice(
        tx,
        input.generationId,
        input.sourceVideoId,
        input.choice,
      )
      return { generationId: input.generationId, replay }
    }
    const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow(
      { where: { id: input.generationId } },
    )
    if (
      !meta.historicalQualification ||
      meta.historicalQualificationDigest !== input.history.qualificationDigest
    )
      conflict("Source history qualification is missing or different")
    if (
      input.history.mappedRows + input.history.unmappedRows !==
        input.history.rowCount ||
      input.history.rangeStart > input.history.rangeEnd
    )
      invalid("Invalid source history totals")
    const navigation = input.history.navigationCoverage
    if (
      navigation.candidateEvents !==
      navigation.qualifiedEvents +
        navigation.homeEvents +
        navigation.selfEvents +
        navigation.crossHostEvents +
        navigation.malformedEvents +
        navigation.unmappedEvents +
        navigation.ambiguousEvents
    )
      invalid("Invalid GA navigation event partition")
    const existing =
      await tx.recommendationPrecomputedBuildSource.findUniqueOrThrow({
        where: {
          generationId_sourceVideoId: {
            generationId: input.generationId,
            sourceVideoId: input.sourceVideoId,
          },
        },
      })
    const progress = existing.checkpoint as { historySummary?: unknown }
    const summary = {
      resultDigest: input.history.resultDigest,
      rowCount: input.history.rowCount,
      mappedRows: input.history.mappedRows,
      unmappedRows: input.history.unmappedRows,
      pageCount: input.history.pageCount,
      queryExecutionCount: input.history.queryExecutionCount,
      navigationCoverage: input.history.navigationCoverage,
    }
    if (
      input.history.pageCount > 0 &&
      !sameJson(progress.historySummary, summary)
    )
      conflict("Source history differs from durable page checkpoint")
    const actualCalls = await tx.recommendationPrecomputedHistoryCall.count({
      where: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
      },
    })
    if (actualCalls < input.history.queryExecutionCount)
      conflict("Source history has fewer HTTP receipts than snapshot queries")
    if (existing.historicalProvenance) {
      if (!sameJson(existing.historicalProvenance, input.history))
        conflict("Source history retry differs")
      return { generationId: input.generationId, replay: true }
    }
    await reserveBudget(
      tx,
      input.generationId,
      Buffer.byteLength(JSON.stringify(input.history), "utf8") + 128,
    )
    await tx.recommendationPrecomputedBuildSource.update({
      where: {
        generationId_sourceVideoId: {
          generationId: input.generationId,
          sourceVideoId: input.sourceVideoId,
        },
      },
      data: { historicalProvenance: checkedJson(input.history, 4_000) },
    })
    return { generationId: input.generationId, replay: false }
  }
  return mutateCallsAndFinish(tx, input, generation)
}

async function mutateCallsAndFinish(
  tx: Tx,
  input: Exclude<Action, { action: "start" | "capacity_probe" | "status" }>,
  generation: LockedGeneration,
): Promise<Record<string, unknown>> {
  const generationStatus = generation.status
  if (input.action === "model_call_start") {
    if (generationStatus !== "incomplete") conflict("Generation is closed")
    const source = await sourceLock(tx, input.generationId, input.sourceVideoId)
    requireLease(source, input.leaseToken)
    const existing = await tx.recommendationPrecomputedModelCall.findUnique({
      where: {
        generationId_callId: {
          generationId: input.generationId,
          callId: input.callId,
        },
      },
    })
    if (existing) {
      if (
        existing.sourceVideoId !== input.sourceVideoId ||
        existing.stage !== input.stage ||
        existing.modelId !== input.modelId ||
        existing.inputDigest !== input.inputDigest ||
        existing.startedAt.getTime() !== date(input.startedAt).getTime() ||
        existing.reservationLeaseToken !== input.leaseToken
      )
        conflict("Model call reservation retry differs")
      return {
        generationId: input.generationId,
        callId: input.callId,
        state: existing.status,
        replay: true,
      }
    }
    await reserveBudget(tx, input.generationId, 384)
    await tx.recommendationPrecomputedModelCall.create({
      data: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
        callId: input.callId,
        stage: input.stage,
        modelId: input.modelId,
        inputDigest: input.inputDigest,
        startedAt: date(input.startedAt),
        status: "pending",
        reservationLeaseToken: input.leaseToken,
      },
    })
    return {
      generationId: input.generationId,
      callId: input.callId,
      state: "pending",
      replay: false,
    }
  }
  if (input.action === "model_call") {
    if (
      (input.status === "succeeded" &&
        (!input.outputDigest || input.errorCode)) ||
      (input.status === "failed" && (input.outputDigest || !input.errorCode)) ||
      date(input.finishedAt) < date(input.startedAt)
    )
      invalid("Invalid model call outcome")
    await tx.$queryRaw`SELECT call_id FROM recommendation_precomputed_model_call
      WHERE generation_id = ${input.generationId} AND call_id = ${input.callId} FOR UPDATE`
    const existing = await tx.recommendationPrecomputedModelCall.findUnique({
      where: {
        generationId_callId: {
          generationId: input.generationId,
          callId: input.callId,
        },
      },
    })
    if (
      !existing ||
      existing.reservationLeaseToken !== input.leaseToken ||
      existing.sourceVideoId !== input.sourceVideoId ||
      existing.stage !== input.stage ||
      existing.modelId !== input.modelId ||
      existing.inputDigest !== input.inputDigest ||
      existing.startedAt.getTime() !== date(input.startedAt).getTime()
    )
      conflict("Model call has no matching reservation")
    const receiptDigest = hash({
      ...input,
      checkpoint: input.checkpoint,
      choice: input.choice ?? null,
    })
    if (existing.status !== "pending") {
      if (existing.receiptDigest !== receiptDigest)
        conflict("Model call receipt retry differs")
      const currentSource = await sourceLock(
        tx,
        input.generationId,
        input.sourceVideoId,
      )
      return {
        generationId: input.generationId,
        callId: input.callId,
        receiptStored: true,
        replay: true,
        checkpointApplied: existing.receiptCheckpointApplied ?? false,
        staleLease: !leaseCurrent(currentSource, input.leaseToken),
        checkpointRevision: existing.receiptAppliedRevision,
      }
    }
    await tx.recommendationPrecomputedModelCall.update({
      where: {
        generationId_callId: {
          generationId: input.generationId,
          callId: input.callId,
        },
      },
      data: {
        status: input.status,
        outputDigest: input.outputDigest ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        cachedInputTokens: input.cachedInputTokens ?? null,
        costUsd: asMoney(input.costUsd),
        errorCode: input.errorCode ?? null,
        finishedAt: date(input.finishedAt),
        receiptDigest,
        receiptCheckpointApplied: false,
      },
    })
    const source = await sourceLock(tx, input.generationId, input.sourceVideoId)
    let capacityFresh = true
    try {
      requireCapacityFresh(generation)
    } catch (error) {
      if (
        error instanceof PrecomputedRecommendationError &&
        ["capacity_attestation_expired", "conflict"].includes(error.code)
      )
        capacityFresh = false
      else throw error
    }
    if (
      generationStatus !== "incomplete" ||
      !capacityFresh ||
      !leaseCurrent(source, input.leaseToken) ||
      !input.checkpoint ||
      input.checkpointId === undefined ||
      input.expectedRevision === undefined ||
      source.checkpoint_revision !== input.expectedRevision
    ) {
      return {
        generationId: input.generationId,
        callId: input.callId,
        receiptStored: true,
        replay: false,
        checkpointApplied: false,
        staleLease: !leaseCurrent(source, input.leaseToken),
        capacityBlocked: !capacityFresh,
        checkpointRevision: source.checkpoint_revision,
      }
    }
    try {
      await reserveBudget(
        tx,
        input.generationId,
        Buffer.byteLength(JSON.stringify(input.checkpoint), "utf8") +
          (input.choice
            ? Buffer.byteLength(JSON.stringify(input.choice), "utf8")
            : 0) +
          256,
      )
    } catch (error) {
      if (
        error instanceof PrecomputedRecommendationError &&
        error.code === "capacity_budget_exceeded"
      )
        return {
          generationId: input.generationId,
          callId: input.callId,
          receiptStored: true,
          replay: false,
          checkpointApplied: false,
          staleLease: false,
          capacityBlocked: true,
          checkpointRevision: source.checkpoint_revision,
        }
      throw error
    }
    try {
      checkedJson(input.checkpoint, 16_000)
      if (
        source.checkpoint_id === input.checkpointId &&
        source.checkpoint_digest !== hash(input.checkpoint)
      )
        conflict("Checkpoint retry differs")
      if (input.choice) {
        checkedJson(input.choice, 8_000)
        await saveChoice(
          tx,
          input.generationId,
          input.sourceVideoId,
          input.choice,
          false,
        )
      }
    } catch (error) {
      // The provider may already have charged this call. A rejected optional
      // checkpoint/choice must not roll back its terminal usage receipt.
      if (
        error instanceof PrecomputedRecommendationError &&
        ["conflict", "invalid"].includes(error.code)
      )
        return {
          generationId: input.generationId,
          callId: input.callId,
          receiptStored: true,
          replay: false,
          checkpointApplied: false,
          checkpointRejected: error.code,
          staleLease: false,
          checkpointRevision: source.checkpoint_revision,
        }
      throw error
    }
    const advanced = await saveCheckpoint(
      tx,
      {
        ...input,
        checkpoint: input.checkpoint,
        checkpointId: input.checkpointId,
        expectedRevision: input.expectedRevision,
      },
      source,
      false,
    )
    await tx.recommendationPrecomputedModelCall.update({
      where: {
        generationId_callId: {
          generationId: input.generationId,
          callId: input.callId,
        },
      },
      data: {
        receiptCheckpointApplied: true,
        receiptAppliedRevision: advanced.checkpointRevision,
      },
    })
    return {
      generationId: input.generationId,
      callId: input.callId,
      receiptStored: true,
      replay: false,
      checkpointApplied: true,
      staleLease: false,
      checkpointRevision: advanced.checkpointRevision,
    }
  }
  if (input.action === "history_call_start") {
    if (generationStatus !== "incomplete") conflict("Generation is closed")
    if (input.sourceVideoId) {
      if (!input.leaseToken) invalid("Source history call requires lease token")
      const source = await sourceLock(
        tx,
        input.generationId,
        input.sourceVideoId,
      )
      requireLease(source, input.leaseToken)
    } else if (input.leaseToken)
      invalid("Global history call cannot carry source lease")
    const existing = await tx.recommendationPrecomputedHistoryCall.findUnique({
      where: {
        generationId_callId: {
          generationId: input.generationId,
          callId: input.callId,
        },
      },
    })
    if (existing) {
      if (
        existing.stage !== input.stage ||
        existing.sourceVideoId !== (input.sourceVideoId ?? null) ||
        existing.requestDigest !== input.requestDigest ||
        existing.startedAt.getTime() !== date(input.startedAt).getTime()
      )
        conflict("History call reservation retry differs")
      return {
        generationId: input.generationId,
        callId: input.callId,
        state: existing.status,
        replay: true,
      }
    }
    await reserveBudget(tx, input.generationId, 256)
    await tx.recommendationPrecomputedHistoryCall.create({
      data: {
        generationId: input.generationId,
        callId: input.callId,
        sourceVideoId: input.sourceVideoId ?? null,
        stage: input.stage,
        requestDigest: input.requestDigest,
        startedAt: date(input.startedAt),
        status: "pending",
      },
    })
    return {
      generationId: input.generationId,
      callId: input.callId,
      state: "pending",
      replay: false,
    }
  }
  if (input.action === "history_call") {
    if (
      (input.status === "succeeded" && input.errorCode) ||
      (input.status === "failed" && !input.errorCode)
    )
      invalid("Invalid history call outcome")
    await tx.$queryRaw`SELECT call_id FROM recommendation_precomputed_history_call
      WHERE generation_id = ${input.generationId} AND call_id = ${input.callId} FOR UPDATE`
    const existing = await tx.recommendationPrecomputedHistoryCall.findUnique({
      where: {
        generationId_callId: {
          generationId: input.generationId,
          callId: input.callId,
        },
      },
    })
    if (!existing || date(input.finishedAt) < existing.startedAt)
      conflict("History call has no matching reservation")
    const receiptDigest = hash(input)
    if (existing.status !== "pending") {
      if (existing.receiptDigest !== receiptDigest)
        conflict("History call receipt retry differs")
      return {
        generationId: input.generationId,
        callId: input.callId,
        receiptStored: true,
        replay: true,
      }
    }
    await tx.recommendationPrecomputedHistoryCall.update({
      where: {
        generationId_callId: {
          generationId: input.generationId,
          callId: input.callId,
        },
      },
      data: {
        status: input.status,
        bytesProcessed:
          input.bytesProcessed === undefined
            ? null
            : BigInt(input.bytesProcessed),
        costUsd: asMoney(input.costUsd),
        errorCode: input.errorCode ?? null,
        finishedAt: date(input.finishedAt),
        receiptDigest,
      },
    })
    return {
      generationId: input.generationId,
      callId: input.callId,
      receiptStored: true,
      replay: false,
    }
  }
  if (input.action === "source") {
    if (generationStatus !== "incomplete") conflict("Generation is closed")
    const source = await sourceLock(tx, input.generationId, input.sourceVideoId)
    if (["complete_edges", "complete_empty"].includes(source.state))
      return {
        generationId: input.generationId,
        sourceState: source.state,
        replay: true,
      }
    requireLease(source, input.leaseToken)
    const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow(
      { where: { id: input.generationId } },
    )
    const sourceMeta =
      await tx.recommendationPrecomputedBuildSource.findUniqueOrThrow({
        where: {
          generationId_sourceVideoId: {
            generationId: input.generationId,
            sourceVideoId: input.sourceVideoId,
          },
        },
      })
    if (
      meta.inputMode === "historical_analytics" &&
      !sourceMeta.historicalProvenance
    )
      conflict("Source historical snapshot is incomplete")
    const provisional = await tx.recommendationPrecomputedBuildChoice.findMany({
      where: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
      },
    })
    const parsed = provisional.map((row) =>
      provisionalChoice.parse(row.payload),
    )
    const ordered = parsed.sort((a, b) =>
      a.kind === b.kind
        ? b.strength - a.strength ||
          (a.targetVideoId < b.targetVideoId
            ? -1
            : a.targetVideoId > b.targetVideoId
              ? 1
              : 0)
        : a.kind === "direct"
          ? -1
          : 1,
    )
    const ranks = { direct: 0, alternative: 0 }
    const choices = ordered.map(({ strength: _strength, ...item }) => ({
      ...item,
      rank: ++ranks[item.kind],
    }))
    if (meta.inputSnapshotMode === "observed_fenced")
      await assertPrecomputedObservedVersion(
        tx,
        [input.sourceVideoId, ...choices.map((item) => item.targetVideoId)],
        meta.inputCutoff,
      )
    const payload = await validatePrecomputedChoices(
      tx,
      input.sourceVideoId,
      choices,
    )
    await reserveBudget(
      tx,
      input.generationId,
      Buffer.byteLength(JSON.stringify(payload), "utf8") + 256,
    )
    await tx.recommendationPrecomputedSource.create({
      data: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
        payload: payload as unknown as Prisma.InputJsonValue,
        submissionDigest: hash(choices),
        acceptedCount: payload.length,
        status: "complete",
      },
    })
    await tx.recommendationPrecomputedBuildChoice.deleteMany({
      where: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
      },
    })
    const state = payload.length ? "complete_edges" : "complete_empty"
    await tx.recommendationPrecomputedBuildSource.update({
      where: {
        generationId_sourceVideoId: {
          generationId: input.generationId,
          sourceVideoId: input.sourceVideoId,
        },
      },
      data: {
        state,
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
        checkpoint: {},
        checkpointId: null,
        checkpointDigest: null,
      },
    })
    return {
      generationId: input.generationId,
      sourceState: state,
      acceptedCount: payload.length,
      replay: false,
    }
  }
  if (input.action === "fail") {
    if (!input.sourceVideoId) {
      if (generationStatus === "failed")
        return {
          generationId: input.generationId,
          state: "failed",
          replay: true,
        }
      if (["complete", "cancelled"].includes(generationStatus))
        conflict("Generation is closed")
      await tx.recommendationPrecomputedGeneration.update({
        where: { id: input.generationId },
        data: {
          status: "failed",
          failedAt: new Date(),
          failureCode: input.failureCode,
        },
      })
      return {
        generationId: input.generationId,
        state: "failed",
        replay: false,
      }
    }
    if (!input.leaseToken) invalid("Source failure requires lease token")
    if (generationStatus !== "incomplete") conflict("Generation is closed")
    const source = await sourceLock(tx, input.generationId, input.sourceVideoId)
    if (source.state === "failed")
      return {
        generationId: input.generationId,
        sourceState: "failed",
        replay: true,
      }
    requireLease(source, input.leaseToken)
    await tx.recommendationPrecomputedSource.create({
      data: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
        payload: [],
        submissionDigest: hash([]),
        acceptedCount: 0,
        status: "failed",
        failureCode: input.failureCode,
      },
    })
    await tx.recommendationPrecomputedBuildChoice.deleteMany({
      where: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
      },
    })
    await tx.recommendationPrecomputedBuildSource.update({
      where: {
        generationId_sourceVideoId: {
          generationId: input.generationId,
          sourceVideoId: input.sourceVideoId,
        },
      },
      data: {
        state: "failed",
        failureCode: input.failureCode,
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
        checkpoint: {},
        checkpointId: null,
        checkpointDigest: null,
      },
    })
    return {
      generationId: input.generationId,
      sourceState: "failed",
      replay: false,
    }
  }
  if (input.action === "complete") {
    if (generationStatus === "complete")
      return {
        generationId: input.generationId,
        state: "complete",
        replay: true,
      }
    if (generationStatus !== "incomplete")
      conflict("Generation is not publishable")
    const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow(
      { where: { id: input.generationId } },
    )
    if (
      !meta.manifestCommittedAt ||
      !meta.capacityPreflight ||
      (meta.capacityPreflight as { status?: string }).status !== "passed"
    )
      conflict("Build manifest or capacity preflight incomplete")
    const sources = await tx.recommendationPrecomputedBuildSource.findMany({
      where: { generationId: input.generationId },
      select: { sourceVideoId: true, state: true, historicalProvenance: true },
    })
    if (
      sources.length !== meta.expectedSourceCount ||
      hash(sources.map((source) => source.sourceVideoId).sort()) !==
        meta.sourceSetDigest ||
      sources.some(
        (source) =>
          !["complete_edges", "complete_empty"].includes(source.state),
      ) ||
      (meta.inputMode === "historical_analytics" &&
        (!meta.historicalQualification ||
          sources.some((source) => !source.historicalProvenance)))
    )
      conflict("Generation source coverage is incomplete or failed")
    const finalized = await tx.recommendationPrecomputedSource.findMany({
      where: { generationId: input.generationId },
      select: { sourceVideoId: true, status: true, acceptedCount: true },
    })
    if (
      finalized.length !== sources.length ||
      finalized.some((source) => source.status !== "complete")
    )
      conflict("Final source rows are incomplete")
    const finalById = new Map(finalized.map((row) => [row.sourceVideoId, row]))
    if (
      sources.some(
        (source) =>
          !finalById.has(source.sourceVideoId) ||
          (source.state === "complete_empty") !==
            (finalById.get(source.sourceVideoId)!.acceptedCount === 0),
      )
    )
      conflict("Final source outcome differs from manifest")
    await tx.recommendationPrecomputedGeneration.update({
      where: { id: input.generationId },
      data: { status: "complete", completedAt: new Date() },
    })
    return {
      generationId: input.generationId,
      state: "complete",
      replay: false,
    }
  }
  return invalid("Unknown durable build action")
}
