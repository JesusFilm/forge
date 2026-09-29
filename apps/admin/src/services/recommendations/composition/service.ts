import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { env } from "@/config/env"
import {
  recommendationTraceActorDigest,
  RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS,
} from "../admin-ops/shared"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "@/services/errors"
import { RecommendationConflictError } from "../errors"
import {
  COWATCH_SHADOW_GENERATOR_KEY,
  COWATCH_DURABLE_LINEAGE_VERSION,
} from "../cowatch/graph"
import { validateCompositionGraph } from "./graph-binding"
import {
  COWATCH_MMR_TRIAL_MANIFEST_ID,
  isExactCowatchMmrTrialManifest,
} from "../promotion/manifest"
import { MMR_SLATE_POLICY_VERSION } from "./mmr"
import {
  COMPOSITION_EVIDENCE_VERSION,
  COMPOSITION_PROTOCOL_VERSION,
  CompositionMetrics,
  CompositionThresholds,
  compositionDigest,
  decideComposition,
  MMR_CONFIG,
  summarizeComposition,
  type CompositionObservation,
} from "./policy"

type Database = Prisma.TransactionClient
export type CompositionOperator = {
  actor: Principal
  authenticatedAt: Date | null
}
export const PrepareComposition = z
  .object({
    protocolId: z.string().uuid(),
    shadowEvaluationId: z.string().uuid(),
    sourceManifestId: z.string().min(1).max(191),
    generatorVersion: z.string().min(1).max(64),
    challengerManifestId: z.string().min(1).max(191),
    thresholds: CompositionThresholds,
    cowatchGenerationId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullish(),
  })
  .strict()

function requireOperator(operator: CompositionOperator, now: Date) {
  if (
    !operator.actor.id ||
    !hasPermission(operator.actor, "operate:recommendation-experiments") ||
    !operator.authenticatedAt ||
    operator.authenticatedAt > now ||
    now.getTime() - operator.authenticatedAt.getTime() > 15 * 60_000
  )
    throw new ForbiddenError("Recent operator authentication required")
  return operator.actor.id
}
function conflict(reason: string): never {
  throw new RecommendationConflictError(reason)
}
async function lockProtocol(tx: Database, id: string) {
  // Match graph invalidators' graph -> protocol lock order.
  await tx.$queryRaw(Prisma.sql`
    SELECT graph.id FROM recommendation_cowatch_generation graph
    JOIN recommendation_composition_protocol protocol ON graph.id = (protocol.config->>'cowatchGenerationId')::char(64)
    WHERE protocol.id = ${id}::uuid FOR SHARE OF graph
  `)
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM recommendation_composition_protocol WHERE id = ${id}::uuid FOR UPDATE`,
  )
}

export async function prepareCompositionProtocol(
  prisma: PrismaClient,
  operator: CompositionOperator,
  raw: z.infer<typeof PrepareComposition>,
  now = new Date(),
) {
  const actorId = requireOperator(operator, now)
  const input = PrepareComposition.parse(raw)
  const cowatchGenerationId = input.cowatchGenerationId ?? null
  const coWatch = input.generatorVersion === COWATCH_SHADOW_GENERATOR_KEY
  if (
    coWatch !== Boolean(cowatchGenerationId) ||
    (coWatch &&
      (input.sourceManifestId !== COWATCH_MMR_TRIAL_MANIFEST_ID ||
        input.challengerManifestId !== COWATCH_MMR_TRIAL_MANIFEST_ID)) ||
    (!coWatch &&
      [input.sourceManifestId, input.challengerManifestId].includes(
        COWATCH_MMR_TRIAL_MANIFEST_ID,
      ))
  )
    conflict("composition_graph_binding_required")
  return prisma.$transaction(async (tx) => {
    const graph = cowatchGenerationId
      ? await validateCompositionGraph(tx, cowatchGenerationId, now)
      : null
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.shadowEvaluationId}, 565))::text`,
    )
    const evaluation = await tx.recommendationShadowEvaluation.findUnique({
      where: { id: input.shadowEvaluationId },
      include: { runs: { take: 1, where: { state: { not: "PENDING" } } } },
    })
    const manifests = await tx.recommendationStrategyManifest.count({
      where: {
        id: {
          in: [
            ...new Set([input.sourceManifestId, input.challengerManifestId]),
          ],
        },
        enabled: true,
      },
    })
    if (
      manifests !==
      new Set([input.sourceManifestId, input.challengerManifestId]).size
    )
      conflict("composition_manifest_unavailable")
    const challenger =
      await tx.recommendationStrategyManifest.findUniqueOrThrow({
        where: { id: input.challengerManifestId },
      })
    if (
      !z
        .object({ composer: z.literal(MMR_SLATE_POLICY_VERSION) })
        .safeParse(challenger.configuration).success
    )
      conflict("composition_manifest_composer_mismatch")
    if (coWatch && !isExactCowatchMmrTrialManifest(challenger))
      conflict("composition_manifest_bundle_mismatch")
    const config = {
      ...MMR_CONFIG,
      thresholds: input.thresholds,
      cowatchGenerationId,
      cowatchDependencyExpiresAt: graph?.expiresAt.toISOString() ?? null,
      challengerManifest: {
        id: challenger.id,
        strategyVersion: challenger.strategyVersion,
        contractVersion: challenger.contractVersion,
        surfaceVersion: challenger.surfaceVersion,
        generator: challenger.generator,
        maxItems: challenger.maxItems,
        configuration: challenger.configuration,
        enabled: challenger.enabled,
      },
    }
    const configDigest = compositionDigest({
      ...input,
      cowatchGenerationId,
      protocolVersion: COMPOSITION_PROTOCOL_VERSION,
      config,
    })
    const existing = await tx.recommendationCompositionProtocol.findUnique({
      where: { shadowEvaluationId: input.shadowEvaluationId },
    })
    if (existing) {
      if (
        existing.id !== input.protocolId ||
        existing.configDigest !== configDigest
      )
        conflict("composition_protocol_conflict")
      return existing
    }
    if (
      evaluation &&
      (evaluation.state !== "ACTIVE" ||
        evaluation.runs.length > 0 ||
        evaluation.requestedSampleSize > 500 ||
        evaluation.manifestId !== input.sourceManifestId ||
        evaluation.generatorVersion !== input.generatorVersion ||
        evaluation.cowatchGenerationId !== cowatchGenerationId)
    )
      conflict("composition_protocol_must_precede_execution")
    return tx.recommendationCompositionProtocol.create({
      data: {
        id: input.protocolId,
        shadowEvaluationId: input.shadowEvaluationId,
        sourceManifestId: input.sourceManifestId,
        generatorVersion: input.generatorVersion,
        challengerManifestId: input.challengerManifestId,
        composerVersion: MMR_SLATE_POLICY_VERSION,
        protocolVersion: COMPOSITION_PROTOCOL_VERSION,
        config,
        configDigest,
        actorId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 365 * 86_400_000),
      },
    })
  })
}

function graphConfig(config: Prisma.JsonValue) {
  return z
    .object({
      cowatchGenerationId: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
      cowatchDependencyExpiresAt: z.string().datetime().nullable(),
    })
    .parse(config)
}

/** Called only inside the fenced shadow publication transaction, after PUBLISHED. */
export async function persistCompositionObservation(
  tx: Database,
  input: { runId: string; observation: CompositionObservation; now: Date },
) {
  // Publication callers take these same locks before mutating the run. Direct
  // callers also start at privacy roots, matching profile -> graph invalidation.
  const roots = await tx.recommendationShadowRun.findUnique({
    where: { id: input.runId },
    select: { requestId: true, projectionProfileId: true },
  })
  if (!roots) return
  if (roots.projectionProfileId)
    await tx.$queryRaw`SELECT id FROM recommendation_profile WHERE id = ${roots.projectionProfileId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM recommendation_request WHERE id = ${roots.requestId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM recommendation_shadow_run WHERE id = ${input.runId} FOR SHARE`
  const run = await tx.recommendationShadowRun.findUnique({
    where: { id: input.runId },
    include: {
      evaluation: true,
      request: true,
      projectionProfile: {
        select: { state: true, privacyGeneration: true, expiresAt: true },
      },
    },
  })
  if (
    !run ||
    run.requestId !== roots.requestId ||
    run.projectionProfileId !== roots.projectionProfileId
  )
    return
  const protocol = await tx.recommendationCompositionProtocol.findUnique({
    where: { shadowEvaluationId: run.evaluationId },
  })
  if (!protocol) return
  await lockProtocol(tx, protocol.id)
  const graph = graphConfig(protocol.config)
  const expiresAt = new Date(
    Math.min(
      run.expiresAt.getTime(),
      run.request.expiresAt.getTime(),
      run.request.createdAt.getTime() + 22 * 86_400_000,
      run.projectionProfile?.expiresAt.getTime() ?? Infinity,
      graph.cowatchDependencyExpiresAt
        ? new Date(graph.cowatchDependencyExpiresAt).getTime()
        : Infinity,
    ),
  )
  if (
    protocol.revokedAt ||
    protocol.expiresAt <= input.now ||
    run.state !== "PUBLISHED" ||
    !run.claimedAt ||
    run.claimedAt < protocol.createdAt ||
    run.sampleOrdinal >= 500 ||
    run.evaluation.requestedSampleSize > 500 ||
    run.evaluation.manifestId !== protocol.sourceManifestId ||
    run.evaluation.generatorVersion !== protocol.generatorVersion ||
    run.evaluation.cowatchGenerationId !== graph.cowatchGenerationId ||
    expiresAt <= input.now ||
    run.request.state !== "ISSUED" ||
    (run.projectionProfileId &&
      (run.projectionProfile?.state !== "ACTIVE" ||
        run.projectionProfile.privacyGeneration !== run.privacyGeneration))
  )
    return
  await tx.recommendationCompositionObservation.create({
    data: {
      runId: run.id,
      protocolId: protocol.id,
      inputDigest: compositionDigest({
        orderedInputDigest: input.observation.inputDigest,
        samplingDigest: run.samplingDigest,
        contextProjectionRef: run.contextProjectionRef,
        contextProjectionVersion: run.contextProjectionVersion,
        contextProjectionDigest: run.contextProjectionDigest,
        privacyGeneration: run.privacyGeneration,
        eligibilityVersion: run.eligibilityVersion,
        retentionPolicyVersion: run.retentionPolicyVersion,
        evaluation: {
          generation: run.evaluation.generation,
          samplingVersion: run.evaluation.samplingVersion,
          contextVersion: run.evaluation.contextVersion,
          eligibilityVersion: run.evaluation.eligibilityVersion,
          windowStart: run.evaluation.windowStart.toISOString(),
          windowEnd: run.evaluation.windowEnd.toISOString(),
          requestedSampleSize: run.evaluation.requestedSampleSize,
          cowatchGenerationId: run.evaluation.cowatchGenerationId,
        },
      }),
      outputDigest: input.observation.outputDigest,
      metrics: CompositionMetrics.parse(input.observation.metrics),
      createdAt: input.now,
      expiresAt,
    },
  })
}

async function loadCurrentEvidence(
  tx: Database,
  protocolId: string,
  now: Date,
) {
  const protocol = await tx.recommendationCompositionProtocol.findUnique({
    where: { id: protocolId },
    include: {
      observations: {
        take: 501,
        orderBy: { runId: "asc" },
        include: {
          run: {
            include: {
              request: true,
              projectionProfile: {
                select: {
                  state: true,
                  privacyGeneration: true,
                  expiresAt: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (!protocol || protocol.revokedAt || protocol.expiresAt <= now)
    conflict("composition_evidence_revoked")
  if (protocol.observations.length > 500)
    conflict("composition_observation_limit")
  const evaluation = await tx.recommendationShadowEvaluation.findUnique({
    where: { id: protocol.shadowEvaluationId },
    include: { _count: { select: { runs: true } }, decision: true },
  })
  const graphBinding = graphConfig(protocol.config)
  const graph = graphBinding.cowatchGenerationId
    ? await validateCompositionGraph(tx, graphBinding.cowatchGenerationId, now)
    : null
  if (
    graph &&
    graph.expiresAt.toISOString() !== graphBinding.cowatchDependencyExpiresAt
  )
    conflict("composition_graph_dependency_changed")
  if (
    !evaluation ||
    evaluation.state !== "TERMINAL" ||
    evaluation.manifestId !== protocol.sourceManifestId ||
    evaluation.generatorVersion !== protocol.generatorVersion ||
    evaluation.cowatchGenerationId !== graphBinding.cowatchGenerationId ||
    (graph && evaluation.decision?.decision !== "PROMOTE_TO_EXPERIMENT") ||
    evaluation.requestedSampleSize > 500
  )
    conflict("composition_shadow_not_terminal")
  const observations = protocol.observations
  if (
    observations.some(
      (row) =>
        row.expiresAt <= now ||
        row.run.expiresAt <= now ||
        row.run.request.expiresAt <= now ||
        row.run.state !== "PUBLISHED" ||
        row.run.request.state !== "ISSUED" ||
        (row.run.projectionProfileId &&
          (row.run.projectionProfile?.state !== "ACTIVE" ||
            row.run.projectionProfile.privacyGeneration !==
              row.run.privacyGeneration ||
            row.run.projectionProfile.expiresAt <= now)),
    )
  )
    conflict("composition_inputs_expired_or_private")
  const summary = summarizeComposition(
    observations.map((row) => CompositionMetrics.parse(row.metrics)),
  )
  const inputDigest = compositionDigest(
    observations.map((row) => [
      row.runId,
      row.inputDigest,
      row.outputDigest,
      row.metrics,
    ]),
  )
  const evidenceDigest = compositionDigest({
    version: COMPOSITION_EVIDENCE_VERSION,
    configDigest: protocol.configDigest,
    inputDigest,
    summary,
  })
  const validUntil = new Date(
    Math.min(
      protocol.expiresAt.getTime(),
      graph?.expiresAt.getTime() ?? Infinity,
      ...observations.map((row) => row.expiresAt.getTime()),
    ),
  )
  return {
    protocol,
    summary,
    inputDigest,
    evidenceDigest,
    validUntil,
    complete: evaluation._count.runs === observations.length,
  }
}

export async function decideCompositionProtocol(
  prisma: PrismaClient,
  operator: CompositionOperator,
  protocolId: string,
  now = new Date(),
) {
  requireOperator(operator, now)
  z.string().uuid().parse(protocolId)
  return prisma.$transaction(async (tx) => {
    await lockProtocol(tx, protocolId)
    const existing = await tx.recommendationCompositionDecision.findUnique({
      where: { protocolId },
    })
    if (existing) return existing
    const evidence = await loadCurrentEvidence(tx, protocolId, now)
    const thresholds = z
      .object({ thresholds: CompositionThresholds })
      .parse(evidence.protocol.config).thresholds
    const result = evidence.complete
      ? decideComposition(evidence.summary, thresholds)
      : {
          decision: "inconclusive",
          reasonCode: "incomplete_request_root_evidence",
        }
    return tx.recommendationCompositionDecision.create({
      data: {
        protocolId,
        ...result,
        evidenceVersion: COMPOSITION_EVIDENCE_VERSION,
        evidenceDigest: evidence.evidenceDigest,
        inputDigest: evidence.inputDigest,
        observationCount: evidence.summary.count,
        summary: evidence.summary,
        authorityRevision: evidence.protocol.authorityRevision,
        validUntil: evidence.validUntil,
        decidedAt: now,
        expiresAt: evidence.protocol.expiresAt,
      },
    })
  })
}

export async function recordCompositionCalibration(
  prisma: PrismaClient,
  operator: CompositionOperator,
  input: {
    protocolId: string
    evidenceDigest: string
    configDigest: string
    rationale: string
  },
  now = new Date(),
) {
  const actorId = requireOperator(operator, now)
  const parsed = z
    .object({
      protocolId: z.string().uuid(),
      evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
      configDigest: z.string().regex(/^[a-f0-9]{64}$/),
      rationale: z.string().trim().min(20).max(512),
    })
    .strict()
    .parse(input)
  return prisma.$transaction(async (tx) => {
    await lockProtocol(tx, parsed.protocolId)
    const evidence = await loadCurrentEvidence(tx, parsed.protocolId, now)
    const decision = await tx.recommendationCompositionDecision.findUnique({
      where: { protocolId: parsed.protocolId },
    })
    if (
      !evidence.complete ||
      !decision ||
      decision.decision !== "qualify_for_controlled_study" ||
      decision.evidenceDigest !== evidence.evidenceDigest ||
      parsed.evidenceDigest !== evidence.evidenceDigest ||
      parsed.configDigest !== evidence.protocol.configDigest ||
      decision.authorityRevision !== evidence.protocol.authorityRevision ||
      decision.validUntil <= now
    )
      conflict("composition_calibration_binding_invalid")
    const reviewDigest = compositionDigest({
      ...parsed,
      actorId,
      authorityRevision: evidence.protocol.authorityRevision,
      status: "reviewed_for_controlled_study",
    })
    const existing = await tx.recommendationCompositionCalibration.findUnique({
      where: { protocolId: parsed.protocolId },
    })
    if (existing) {
      if (existing.reviewDigest !== reviewDigest)
        conflict("composition_calibration_conflict")
      return existing
    }
    return tx.recommendationCompositionCalibration.create({
      data: {
        ...parsed,
        actorId,
        reviewDigest,
        authorityRevision: evidence.protocol.authorityRevision,
        reviewedAt: now,
        expiresAt: evidence.protocol.expiresAt,
      },
    })
  })
}

export type CompositionBinding = Readonly<{
  protocolId: string
  manifestId: string
  composerVersion: string
  configDigest: string
  evidenceDigest: string
  reviewDigest: string
  authorityRevision: number
  cowatchGenerationId?: string | null
}>

/** Constant indexed authority lookup. Revocation triggers maintain source validity. */
export async function resolveCompositionQualification(
  tx: Pick<PrismaClient, "$queryRaw">,
  binding: CompositionBinding,
  now = new Date(),
) {
  const rows = await tx.$queryRaw<Array<{ validUntil: Date }>>(Prisma.sql`
    SELECT decision.valid_until AS "validUntil"
    FROM recommendation_composition_protocol protocol
    JOIN recommendation_strategy_manifest manifest ON manifest.id = protocol.challenger_manifest_id AND manifest.enabled AND manifest.configuration->>'composer' = protocol.composer_version
    JOIN recommendation_composition_decision decision ON decision.protocol_id = protocol.id
    JOIN recommendation_composition_calibration review ON review.protocol_id = protocol.id
    LEFT JOIN recommendation_cowatch_generation graph ON graph.id = ${binding.cowatchGenerationId ?? null}::char(64)
    WHERE protocol.id = ${binding.protocolId}::uuid
      AND protocol.challenger_manifest_id = ${binding.manifestId}
      AND protocol.composer_version = ${MMR_SLATE_POLICY_VERSION}
      AND protocol.composer_version = ${binding.composerVersion}
      AND protocol.protocol_version = ${COMPOSITION_PROTOCOL_VERSION}
      AND protocol.config_digest = ${binding.configDigest}
      AND protocol.config->>'cowatchGenerationId' IS NOT DISTINCT FROM ${binding.cowatchGenerationId ?? null}
      AND jsonb_build_object('id',manifest.id,'strategyVersion',manifest.strategy_version,
        'contractVersion',manifest.contract_version,'surfaceVersion',manifest.surface_version,
        'generator',manifest.generator,'maxItems',manifest.max_items,
        'configuration',manifest.configuration,'enabled',manifest.enabled) = protocol.config->'challengerManifest'
      AND ((protocol.config->>'cowatchGenerationId' IS NULL AND protocol.generator_version <> ${COWATCH_SHADOW_GENERATOR_KEY}) OR
        (graph.id IS NOT NULL AND graph.invalidated_at IS NULL AND graph.expires_at > ${now}
          AND graph.lineage_version = ${COWATCH_DURABLE_LINEAGE_VERSION}
          AND protocol.generator_version = ${COWATCH_SHADOW_GENERATOR_KEY}
          AND protocol.source_manifest_id = ${COWATCH_MMR_TRIAL_MANIFEST_ID}
          AND protocol.challenger_manifest_id = ${COWATCH_MMR_TRIAL_MANIFEST_ID}
          AND (protocol.config->>'cowatchDependencyExpiresAt')::timestamptz > ${now}))
      AND protocol.config @> ${JSON.stringify(MMR_CONFIG)}::jsonb
      AND protocol.authority_revision = ${binding.authorityRevision}
      AND protocol.revoked_at IS NULL AND protocol.expires_at > ${now} AND protocol.created_at <= ${now}
      AND decision.authority_revision = protocol.authority_revision
      AND decision.decision = 'qualify_for_controlled_study'
      AND decision.evidence_version = ${COMPOSITION_EVIDENCE_VERSION}
      AND decision.evidence_digest = ${binding.evidenceDigest}
      AND decision.valid_until > ${now} AND decision.expires_at > ${now} AND decision.decided_at <= ${now}
      AND review.evidence_digest = decision.evidence_digest
      AND review.config_digest = protocol.config_digest
      AND review.review_digest = ${binding.reviewDigest}
      AND review.authority_revision = protocol.authority_revision
      AND review.expires_at > ${now} AND review.reviewed_at <= ${now}
  `)
  return rows[0] ? { ...binding, validUntil: rows[0].validUntil } : null
}

export async function inspectComposition(
  prisma: PrismaClient,
  actor: Principal,
  protocolId: string,
  now = new Date(),
) {
  if (!hasPermission(actor, "read:recommendation-aggregates"))
    throw new ForbiddenError("Permission denied")
  z.string().uuid().parse(protocolId)
  const protocol = await prisma.recommendationCompositionProtocol.findUnique({
    where: { id: protocolId },
    include: { decision: true, calibration: true },
  })
  if (!protocol) return null
  const binding =
    protocol.decision && protocol.calibration
      ? {
          protocolId,
          manifestId: protocol.challengerManifestId,
          composerVersion: protocol.composerVersion,
          configDigest: protocol.configDigest,
          evidenceDigest: protocol.decision.evidenceDigest,
          reviewDigest: protocol.calibration.reviewDigest,
          authorityRevision: protocol.authorityRevision,
          cowatchGenerationId: graphConfig(protocol.config).cowatchGenerationId,
        }
      : null
  const qualified = binding
    ? await resolveCompositionQualification(prisma, binding, now)
    : null
  const traces =
    hasPermission(actor, "read:recommendation-traces") && actor.id
      ? await prisma.$transaction(async (tx) => {
          const rows = await tx.recommendationCompositionObservation.findMany({
            where: {
              protocolId,
              expiresAt: { gt: now },
              run: { state: "PUBLISHED" },
            },
            take: 10,
            orderBy: { runId: "asc" },
            select: {
              inputDigest: true,
              metrics: true,
              run: {
                select: {
                  requestId: true,
                  nominations: {
                    take: 64,
                    orderBy: { ordinal: "asc" },
                    select: { targetMediaId: true, provenance: true },
                  },
                },
              },
            },
          })
          await tx.recommendationTraceAccessAudit.createMany({
            data: rows.map((row) => ({
              requestId: row.run.requestId,
              actorDigest: recommendationTraceActorDigest(
                actor.id!,
                env.ADMIN_SESSION_SECRET,
              ),
              reasonCode: "composition_inspection",
              accessedAt: now,
              expiresAt: new Date(
                now.getTime() +
                  RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS * 86_400_000,
              ),
            })),
          })
          return rows.map((row) => ({
            inputDigest: row.inputDigest,
            metrics: row.metrics,
            run: { nominations: row.run.nominations },
          }))
        })
      : []
  return {
    protocol,
    binding,
    qualification: qualified
      ? "ready_for_exact_controlled_study"
      : "unavailable",
    calibrationStatus: protocol.calibration
      ? "reviewed_for_controlled_study"
      : "uncalibrated",
    usefulness: "not_evaluated",
    traces,
  }
}

/** Standalone bounded retention phase; never carry its protocol locks into
 * request/profile/graph deletion. Skip contended observations/protocols rather
 * than waiting while a source invalidator owns the opposite end of a cascade.
 * Aggregate roots are removed after their observations have drained.
 */
export async function purgeExpiredCompositionEvidence(
  tx: Database,
  now = new Date(),
) {
  const observations = await tx.$queryRaw<
    Array<{ runId: string; protocolId: string }>
  >(Prisma.sql`
    SELECT run_id AS "runId", protocol_id AS "protocolId" FROM recommendation_composition_observation
    WHERE expires_at <= ${now} ORDER BY expires_at, run_id LIMIT 500 FOR UPDATE SKIP LOCKED
  `)
  const protocolIds = [...new Set(observations.map((row) => row.protocolId))]
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM recommendation_composition_protocol WHERE id = ANY(${protocolIds}::uuid[])
    ORDER BY id FOR UPDATE SKIP LOCKED
  `)
  const admitted = new Set(locked.map((row) => row.id))
  const removedObservations =
    await tx.recommendationCompositionObservation.deleteMany({
      where: {
        runId: {
          in: observations
            .filter((row) => admitted.has(row.protocolId))
            .map((row) => row.runId),
        },
      },
    })
  const protocols = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT protocol.id FROM recommendation_composition_protocol protocol
    WHERE protocol.expires_at <= ${now} AND NOT EXISTS (
      SELECT 1 FROM recommendation_composition_observation observation WHERE observation.protocol_id = protocol.id
    ) ORDER BY protocol.expires_at, protocol.id LIMIT 50 FOR UPDATE OF protocol SKIP LOCKED
  `)
  const removedProtocols =
    await tx.recommendationCompositionProtocol.deleteMany({
      where: { id: { in: protocols.map((row) => row.id) } },
    })
  return {
    observations: removedObservations.count,
    protocols: removedProtocols.count,
  }
}

/**
 * Issuance fence: call inside the same deadline-bound transaction that persists
 * the served slate. Source invalidators update the protocol; these shared locks
 * keep that revocation (and manifest disablement) ordered after this issuance.
 */
export async function lockCompositionQualificationForIssuance(
  tx: Database,
  binding: CompositionBinding,
  now = new Date(),
) {
  const startedAt = Date.now()
  await tx.$queryRaw(Prisma.sql`
    SELECT graph.id FROM recommendation_cowatch_generation graph
    JOIN recommendation_composition_protocol protocol ON graph.id = (protocol.config->>'cowatchGenerationId')::char(64)
    WHERE protocol.id = ${binding.protocolId}::uuid FOR SHARE OF graph
  `)
  await tx.$queryRaw(Prisma.sql`
    SELECT protocol.id
    FROM recommendation_composition_protocol protocol
    JOIN recommendation_strategy_manifest manifest
      ON manifest.id = protocol.challenger_manifest_id
    WHERE protocol.id = ${binding.protocolId}::uuid
    FOR SHARE OF protocol, manifest
  `)
  return resolveCompositionQualification(
    tx,
    binding,
    new Date(now.getTime() + Math.max(0, Date.now() - startedAt)),
  )
}

/** Historical through-horizon proof only; never use for current serving.
 * Any later revocation conservatively makes the retained proof unavailable.
 * Aggregate history cannot recreate authority after graph/root deletion.
 */
export async function resolveRetainedCompositionQualification(
  tx: Pick<PrismaClient, "$queryRaw">,
  binding: CompositionBinding,
  trialValidUntil: Date,
) {
  if (!Number.isFinite(trialValidUntil.getTime())) return null
  return resolveCompositionQualification(tx, binding, trialValidUntil)
}
