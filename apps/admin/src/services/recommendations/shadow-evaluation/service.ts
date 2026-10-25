import { persistCompositionObservation } from "../composition/service"
import {
  cowatchTrialCandidateReadiness,
  requireCowatchShadowBinding,
} from "./cowatch-readiness"
import { randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationProfileState,
  RecommendationShadowEvaluationState,
  RecommendationShadowRunState,
  type PrismaClient,
} from "@prisma/client"
import { RecommendationInternalStateError } from "../errors"
import {
  HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
  type CandidateNomination,
  type CandidatePresentation,
  type RecommendationCandidateContext,
} from "../candidate"
import {
  COWATCH_MMR_SHADOW_SAMPLING_VERSION,
  COWATCH_MMR_TRIAL_MANIFEST_ID,
  HYBRID_PERSONALIZED_MANIFEST_ID,
} from "../promotion/manifest"
import type { ViewingModeAffinity } from "../viewing-mode"
import { COWATCH_SHADOW_GENERATOR_KEY } from "../cowatch/graph"
import { servedSnapshotValue } from "../served-item-payload"
import { reconstructShadowHistory, type ShadowHistory } from "./history"
import {
  aggregateShadowMetrics,
  decideShadowEvaluation,
  digestIds,
  digestShadowValue,
  evaluateShadowProjection,
  latestShadowDate,
  safeShadowLiveItem,
  SHADOW_RETENTION_POLICY_VERSION,
  SHADOW_SAMPLING_VERSION,
  shadowDecisionEnum,
  shadowDecisionName,
} from "./projection"

export const SHADOW_RUN_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1_000
const MAX_SHADOW_ITEMS = 6
const SHADOW_AGGREGATE_RETENTION_DAYS = 365

export async function createShadowEvaluation(
  prisma: PrismaClient,
  input: {
    manifestId: string
    generatorVersion: string
    contextVersion: string
    eligibilityVersion: string
    windowStart: Date
    windowEnd: Date
    requestedSampleSize: number
    now?: Date
    evaluationId?: string
    cowatchGenerationId?: string
  },
) {
  const now = input.now ?? new Date()
  const samplingVersion =
    input.manifestId === COWATCH_MMR_TRIAL_MANIFEST_ID
      ? COWATCH_MMR_SHADOW_SAMPLING_VERSION
      : SHADOW_SAMPLING_VERSION
  const requestedSampleSize = Math.max(
    1,
    Math.min(10_000, Math.trunc(input.requestedSampleSize)),
  )
  if (input.windowStart >= input.windowEnd) {
    throw new RangeError("Shadow evaluation window is invalid")
  }
  return prisma.$transaction(async (tx) => {
    const evaluationId = input.evaluationId ?? randomUUID()
    if (input.manifestId === COWATCH_MMR_TRIAL_MANIFEST_ID) {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${evaluationId}, 565))::text`,
      )
    }
    await requireCowatchShadowBinding(
      tx,
      {
        id: evaluationId,
        manifestId: input.manifestId,
        generatorVersion: input.generatorVersion,
        cowatchGenerationId: input.cowatchGenerationId ?? null,
        requestedSampleSize,
        samplingVersion,
      },
      now,
    )
    const manifest = await tx.recommendationStrategyManifest.findUnique({
      where: { id: input.manifestId },
      select: { id: true, enabled: true },
    })
    if (!manifest?.enabled) {
      throw new RecommendationInternalStateError(
        "shadow_generator_manifest_unavailable",
      )
    }
    return tx.recommendationShadowEvaluation.create({
      data: {
        id: evaluationId,
        cowatchGenerationId: input.cowatchGenerationId ?? null,
        manifestId: manifest.id,
        generatorVersion: input.generatorVersion.slice(0, 64),
        samplingVersion,
        contextVersion: input.contextVersion.slice(0, 64),
        eligibilityVersion: input.eligibilityVersion.slice(0, 64),
        retentionPolicyVersion: SHADOW_RETENTION_POLICY_VERSION,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        requestedSampleSize,
        expiresAt: new Date(
          now.getTime() + SHADOW_AGGREGATE_RETENTION_DAYS * 86_400_000,
        ),
      },
    })
  })
}

export async function sampleShadowEvaluationContexts(
  prisma: PrismaClient,
  input: {
    evaluationId: string
    expectedGeneration: number
    now?: Date
    contextSource?: "live" | "profile"
  },
): Promise<
  | Readonly<{
      status: "sampled"
      sampledCount: number
      createdCount: number
    }>
  | Readonly<{ status: "fenced"; reason: string }>
> {
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const evaluation = await tx.recommendationShadowEvaluation.findUnique({
      where: { id: input.evaluationId },
      select: {
        id: true,
        manifestId: true,
        state: true,
        generation: true,
        samplingVersion: true,
        contextVersion: true,
        eligibilityVersion: true,
        retentionPolicyVersion: true,
        windowStart: true,
        windowEnd: true,
        requestedSampleSize: true,
      },
    })
    if (!evaluation) {
      return { status: "fenced" as const, reason: "evaluation_missing" }
    }
    if (
      evaluation.state !== RecommendationShadowEvaluationState.ACTIVE ||
      evaluation.generation !== input.expectedGeneration
    ) {
      return {
        status: "fenced" as const,
        reason: "evaluation_generation_changed",
      }
    }
    const trial = evaluation.manifestId === COWATCH_MMR_TRIAL_MANIFEST_ID
    if (trial) {
      if (
        input.contextSource !== "profile" ||
        evaluation.samplingVersion !== COWATCH_MMR_SHADOW_SAMPLING_VERSION
      )
        return {
          status: "fenced" as const,
          reason: "shadow_sampling_contract_invalid",
        }
      await tx.$queryRaw`SELECT set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${evaluation.id}, 565))::text`,
      )
      // Capture one immutable population. A retry must not replace expired or
      // failed members with newly eligible requests to improve the denominator.
      const captured =
        await tx.recommendationShadowEvaluation.findUniqueOrThrow({
          where: { id: evaluation.id },
          select: {
            sampledAt: true,
            sampledCount: true,
            state: true,
            generation: true,
          },
        })
      if (
        captured.state !== RecommendationShadowEvaluationState.ACTIVE ||
        captured.generation !== input.expectedGeneration
      )
        return {
          status: "fenced" as const,
          reason: "evaluation_generation_changed",
        }
      if (captured.sampledAt)
        return {
          status: "sampled" as const,
          sampledCount: captured.sampledCount,
          createdCount: 0,
        }
    }
    type SampledRequest = {
      id: string
      createdAt: Date
      expiresAt: Date
      candidateRunId: string
      projectionId?: string | null
      projectionVersion?: string | null
      projectionDigest?: string | null
      projectionPublishedAt?: Date | null
      projectionProfileId?: string | null
      privacyGeneration?: number | null
    }
    const sampled: SampledRequest[] =
      input.contextSource === "profile"
        ? await tx.$queryRaw<SampledRequest[]>(Prisma.sql`
            SELECT
              request.id,
              request.created_at AS "createdAt",
              LEAST(
                request.expires_at,
                COALESCE(projection.expires_at, request.expires_at)
              ) AS "expiresAt",
              candidate.id AS "candidateRunId",
              projection.id AS "projectionId",
              projection.projection_version AS "projectionVersion",
              projection.input_digest AS "projectionDigest",
              projection.published_at AS "projectionPublishedAt",
              projection.profile_id AS "projectionProfileId",
              projection.privacy_generation AS "privacyGeneration"
            FROM recommendation_request request
            JOIN recommendation_candidate_run candidate
              ON candidate.request_id = request.id
            LEFT JOIN LATERAL (
              SELECT chosen.*
              FROM (
                SELECT generation.*, 0 AS priority
                FROM recommendation_profile_session_link link
                JOIN recommendation_profile profile
                  ON profile.id = link.profile_id
                  AND profile.state = 'active'
                  AND profile.privacy_generation = link.privacy_generation
                  AND profile.expires_at > ${now}
                JOIN recommendation_profile_projection_pointer pointer
                  ON pointer.scope = 'durable'
                  AND pointer.profile_id = profile.id
                  AND pointer.privacy_generation = profile.privacy_generation
                JOIN recommendation_profile_projection_generation generation
                  ON generation.id = pointer.generation_id
                  AND generation.state = 'published'
                  AND generation.expires_at > ${now}
                  ${
                    trial
                      ? Prisma.sql`AND generation.scope = 'durable'
                    AND generation.profile_id = profile.id
                    AND generation.privacy_generation = profile.privacy_generation
                    AND generation.durable_interest_count > 0`
                      : Prisma.empty
                  }
                WHERE link.session_digest = request.session_digest
                  AND link.expires_at > ${now}
                UNION ALL
                SELECT generation.*, 1 AS priority
                FROM recommendation_profile_projection_pointer pointer
                JOIN recommendation_profile_projection_generation generation
                  ON generation.id = pointer.generation_id
                  AND generation.state = 'published'
                  AND generation.expires_at > ${now}
                WHERE pointer.scope = 'session'
                  AND pointer.session_digest = request.session_digest
                  ${trial ? Prisma.sql`AND false` : Prisma.empty}
              ) chosen
              ORDER BY chosen.priority, chosen.generation DESC, chosen.id
              LIMIT 1
            ) projection ON true
            WHERE request.state = 'issued'
              AND request.created_at >= ${evaluation.windowStart}
              AND request.created_at < ${evaluation.windowEnd}
              AND request.expires_at > ${now}
              ${
                trial
                  ? Prisma.sql`AND projection.id IS NOT NULL
                AND request.locale = 'en'
                AND NOT EXISTS (
                  SELECT 1 FROM recommendation_served_item item
                  WHERE item.request_id = request.id
                    AND (CASE WHEN request.served_item_payload IS NULL
                      THEN item.presentation
                      ELSE request.served_item_payload -> 'items' -> item.id -> 'presentation'
                    END)->>'audioLanguageSlug' IS DISTINCT FROM 'english'
                )`
                  : Prisma.empty
              }
              AND EXISTS (
                SELECT 1 FROM recommendation_served_item item
                WHERE item.request_id = request.id
              )
            ORDER BY md5(${evaluation.id} || ':' || request.id), request.id
            LIMIT ${evaluation.requestedSampleSize}
          `)
        : await tx.$queryRaw<SampledRequest[]>(Prisma.sql`
      SELECT
        request.id,
        request.created_at AS "createdAt",
        request.expires_at AS "expiresAt",
        candidate.id AS "candidateRunId"
      FROM recommendation_request request
      JOIN recommendation_candidate_run candidate
        ON candidate.request_id = request.id
      WHERE request.state = 'issued'
        AND request.created_at >= ${evaluation.windowStart}
        AND request.created_at < ${evaluation.windowEnd}
        AND request.expires_at > ${now}
        AND EXISTS (
          SELECT 1
          FROM recommendation_served_item item
          WHERE item.request_id = request.id
        )
      ORDER BY md5(${evaluation.id} || ':' || request.id), request.id
      LIMIT ${evaluation.requestedSampleSize}
    `)
    const rows = sampled.map((request, sampleOrdinal) => {
      const profileContext = input.contextSource === "profile"
      const contextProjectionRef = profileContext
        ? (request.projectionId ?? null)
        : request.candidateRunId
      const contextProjectionVersion = profileContext
        ? (request.projectionVersion ?? evaluation.contextVersion)
        : evaluation.contextVersion
      return {
        id: randomUUID(),
        evaluationId: evaluation.id,
        requestId: request.id,
        liveCandidateRunId: request.candidateRunId,
        projectionProfileId: profileContext
          ? (request.projectionProfileId ?? null)
          : null,
        privacyGeneration: profileContext
          ? (request.privacyGeneration ?? null)
          : null,
        sampleOrdinal,
        samplingDigest: digestShadowValue([
          evaluation.id,
          request.id,
          evaluation.samplingVersion,
          sampleOrdinal,
        ]),
        contextProjectionRef,
        contextProjectionVersion,
        contextProjectionDigest: contextProjectionRef
          ? profileContext && request.projectionDigest
            ? request.projectionDigest
            : digestShadowValue([
                contextProjectionRef,
                contextProjectionVersion,
                evaluation.eligibilityVersion,
              ])
          : null,
        eligibilityVersion: evaluation.eligibilityVersion,
        retentionPolicyVersion: evaluation.retentionPolicyVersion,
        inputCapturedAt:
          profileContext && request.projectionPublishedAt
            ? request.projectionPublishedAt
            : request.createdAt,
        expiresAt: request.expiresAt,
      }
    })
    const created =
      rows.length === 0
        ? { count: 0 }
        : await tx.recommendationShadowRun.createMany({
            data: rows,
            skipDuplicates: true,
          })
    const sampledCount = await tx.recommendationShadowRun.count({
      where: { evaluationId: evaluation.id },
    })
    const update = await tx.recommendationShadowEvaluation.updateMany({
      where: {
        id: evaluation.id,
        state: RecommendationShadowEvaluationState.ACTIVE,
        generation: input.expectedGeneration,
      },
      data: { sampledCount, ...(trial ? { sampledAt: now } : {}) },
    })
    if (update.count !== 1) {
      throw new RecommendationInternalStateError("shadow_sampling_fenced")
    }
    return {
      status: "sampled" as const,
      sampledCount,
      createdCount: created.count,
    }
  })
}

/**
 * Samples the same immutable live requests but binds each run to the latest
 * exact published U19 projection (durable first, session-only second). A
 * missing projection is intentionally still sampled so the generator records
 * the semantic-control fallback instead of inventing profile state.
 * The bundled trial instead applies its preregistered durable English cohort
 * before stable sampling. Failures within that cohort stay in the denominator.
 */
export function sampleProfileShadowEvaluationContexts(
  prisma: PrismaClient,
  input: {
    evaluationId: string
    expectedGeneration: number
    now?: Date
  },
) {
  return sampleShadowEvaluationContexts(prisma, {
    ...input,
    contextSource: "profile",
  })
}

export type ShadowGeneratorContext = Readonly<{
  history?: ShadowHistory
  surface: "watch-below-player-v1"
  purpose: "watch"
  locale: string
  audioLanguageSlug: string
  seedMediaId: string | null
  manifestId: string
  contextProjection: Readonly<{
    ref: string | null
    version: string
    digest: string | null
    privacyGeneration: number | null
  }>
  liveItems: ReadonlyArray<
    Readonly<{
      targetMediaId: string
      position: number
      presentation: CandidatePresentation
    }>
  >
}>

export type ShadowGenerator = (context: ShadowGeneratorContext) => Promise<
  Readonly<{
    nominations: CandidateNomination[]
    projectionCapturedAt: Date | null
    cohortQuality: number | null
    sourceFailureReason?: string | null
    viewingMode?: ViewingModeAffinity | null
  }>
>

export async function claimNextShadowRun(
  prisma: PrismaClient,
  input: {
    evaluationId: string
    expectedGeneration: number
    now?: Date
    claimId?: string
  },
): Promise<
  | Readonly<{
      status: "claimed"
      runId: string
      claimId: string
      generation: number
    }>
  | Readonly<{ status: "empty" }>
  | Readonly<{ status: "fenced" }>
> {
  const now = input.now ?? new Date()
  const claimId = input.claimId ?? randomUUID()
  return prisma.$transaction(async (tx) => {
    // Freeze any composition protocol before execution admission. Preparation
    // uses this same evaluation-scoped lock, so a racing claim cannot slip
    // between its pending-state check and immutable protocol publication.
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.evaluationId}, 565))::text`,
    )
    const run = await tx.recommendationShadowRun.findFirst({
      where: {
        evaluationId: input.evaluationId,
        state: RecommendationShadowRunState.PENDING,
        expiresAt: { gt: now },
        evaluation: {
          state: RecommendationShadowEvaluationState.ACTIVE,
          generation: input.expectedGeneration,
        },
      },
      orderBy: [{ sampleOrdinal: "asc" }, { id: "asc" }],
      select: { id: true, generation: true },
    })
    if (!run) return { status: "empty" as const }
    const claimed = await tx.recommendationShadowRun.updateMany({
      where: {
        id: run.id,
        generation: run.generation,
        state: RecommendationShadowRunState.PENDING,
        evaluation: {
          state: RecommendationShadowEvaluationState.ACTIVE,
          generation: input.expectedGeneration,
        },
      },
      data: {
        state: RecommendationShadowRunState.CLAIMED,
        claimId,
        claimedAt: now,
        heartbeatAt: now,
      },
    })
    if (claimed.count !== 1) return { status: "fenced" as const }
    return {
      status: "claimed" as const,
      runId: run.id,
      claimId,
      generation: run.generation,
    }
  })
}

export async function heartbeatShadowRun(
  prisma: PrismaClient,
  input: {
    runId: string
    expectedRunGeneration: number
    expectedEvaluationGeneration: number
    claimId: string
    now?: Date
  },
): Promise<boolean> {
  const heartbeat = await prisma.recommendationShadowRun.updateMany({
    where: {
      id: input.runId,
      generation: input.expectedRunGeneration,
      claimId: input.claimId,
      state: RecommendationShadowRunState.CLAIMED,
      evaluation: {
        state: RecommendationShadowEvaluationState.ACTIVE,
        generation: input.expectedEvaluationGeneration,
      },
    },
    data: { heartbeatAt: input.now ?? new Date() },
  })
  return heartbeat.count === 1
}

export async function failClaimedShadowRun(
  prisma: PrismaClient,
  input: {
    runId: string
    expectedRunGeneration: number
    expectedEvaluationGeneration: number
    claimId: string
    reason: string
    now?: Date
  },
): Promise<boolean> {
  const now = input.now ?? new Date()
  const failed = await prisma.recommendationShadowRun.updateMany({
    where: {
      id: input.runId,
      generation: input.expectedRunGeneration,
      claimId: input.claimId,
      state: RecommendationShadowRunState.CLAIMED,
      evaluation: {
        state: RecommendationShadowEvaluationState.ACTIVE,
        generation: input.expectedEvaluationGeneration,
      },
    },
    data: {
      state: RecommendationShadowRunState.FAILED,
      failureReason: input.reason.slice(0, 64),
      finishedAt: now,
      heartbeatAt: now,
    },
  })
  return failed.count === 1
}

export async function executeClaimedShadowRun(
  prisma: PrismaClient,
  input: {
    runId: string
    expectedRunGeneration: number
    expectedEvaluationGeneration: number
    claimId: string
    generator: ShadowGenerator
    now?: Date
    nowMilliseconds?: () => number
  },
): Promise<
  | Readonly<{ status: "published"; replay: boolean }>
  | Readonly<{ status: "fenced"; reason: string }>
> {
  const now = input.now ?? new Date()
  const run = await prisma.recommendationShadowRun.findUnique({
    where: { id: input.runId },
    include: {
      evaluation: {
        select: {
          state: true,
          generation: true,
          manifestId: true,
          generatorVersion: true,
          cowatchGenerationId: true,
          eligibilityVersion: true,
        },
      },
      projectionProfile: {
        select: { state: true, privacyGeneration: true },
      },
      request: {
        select: {
          id: true,
          state: true,
          surfaceVersion: true,
          seedMediaId: true,
          locale: true,
          expectedItemCount: true,
          servedItemPayload: true,
          sessionDigest: true,
          createdAt: true,
          expiresAt: true,
          items: {
            orderBy: [{ position: "asc" }, { id: "asc" }],
            take: MAX_SHADOW_ITEMS,
            select: {
              id: true,
              targetMediaId: true,
              position: true,
              presentation: true,
              candidateProvenance: true,
            },
          },
        },
      },
    },
  })
  if (!run) return { status: "fenced", reason: "run_missing" }
  if (run.state === RecommendationShadowRunState.PUBLISHED) {
    return { status: "published", replay: true }
  }
  if (
    run.state !== RecommendationShadowRunState.CLAIMED ||
    run.generation !== input.expectedRunGeneration ||
    run.claimId !== input.claimId ||
    run.evaluation.state !== RecommendationShadowEvaluationState.ACTIVE ||
    run.evaluation.generation !== input.expectedEvaluationGeneration
  ) {
    return { status: "fenced", reason: "claim_generation_changed" }
  }
  if (
    run.projectionProfileId != null &&
    (run.projectionProfile?.state !== RecommendationProfileState.ACTIVE ||
      run.projectionProfile.privacyGeneration !== run.privacyGeneration)
  ) {
    await redactAndFenceShadowRun(prisma, run.id, {
      generation: run.generation,
      claimId: input.claimId,
      now,
      reason: "profile_generation_revoked",
    })
    return { status: "fenced", reason: "profile_generation_revoked" }
  }
  if (
    run.request.state !== "ISSUED" ||
    run.request.surfaceVersion !== "watch-below-player-v1"
  ) {
    await fenceShadowRun(
      prisma,
      run.id,
      run.generation,
      input.claimId,
      now,
      "live_request_ineligible",
    )
    return { status: "fenced", reason: "live_request_ineligible" }
  }

  if (
    run.evaluation.generatorVersion === COWATCH_SHADOW_GENERATOR_KEY &&
    !/^[a-f0-9]{64}$/.test(run.evaluation.cowatchGenerationId ?? "")
  ) {
    await fenceShadowRun(
      prisma,
      run.id,
      run.generation,
      input.claimId,
      now,
      "shadow_graph_binding_required",
    )
    return { status: "fenced", reason: "shadow_graph_binding_required" }
  }
  const liveItems = run.request.items.map((item) =>
    safeShadowLiveItem(
      servedSnapshotValue(run.request.servedItemPayload, item),
      run.request.locale,
    ),
  )
  const audioLanguageSlug = liveItems[0]?.presentation.audioLanguageSlug
  if (!audioLanguageSlug) {
    await fenceShadowRun(
      prisma,
      run.id,
      run.generation,
      input.claimId,
      now,
      "live_context_incomplete",
    )
    return { status: "fenced", reason: "live_context_incomplete" }
  }
  const context: RecommendationCandidateContext = {
    surface: "watch-below-player-v1",
    purpose: "watch",
    locale: run.request.locale,
    audioLanguageSlug,
  }
  const history = await reconstructShadowHistory(prisma, run.request, now)
  const startedAt = (input.nowMilliseconds ?? Date.now)()
  const generated = await input.generator({
    history,
    surface: "watch-below-player-v1",
    purpose: "watch",
    locale: context.locale,
    audioLanguageSlug: context.audioLanguageSlug,
    seedMediaId: run.request.seedMediaId,
    manifestId: run.evaluation.manifestId,
    contextProjection: {
      ref: run.contextProjectionRef,
      version: run.contextProjectionVersion,
      digest: run.contextProjectionDigest,
      privacyGeneration: run.privacyGeneration,
    },
    liveItems,
  })
  if (
    generated.nominations.some(
      (nomination) =>
        nomination.source.generator === "directional-cowatch" &&
        (run.evaluation.generatorVersion !== COWATCH_SHADOW_GENERATOR_KEY ||
          nomination.source.evidence.generation !==
            run.evaluation.cowatchGenerationId),
    )
  ) {
    await fenceShadowRun(
      prisma,
      run.id,
      run.generation,
      input.claimId,
      now,
      "shadow_graph_nomination_mismatch",
    )
    return { status: "fenced", reason: "shadow_graph_nomination_mismatch" }
  }
  const latencyMs = Math.max(
    0,
    (input.nowMilliseconds ?? Date.now)() - startedAt,
  )
  const projection = evaluateShadowProjection({
    context,
    liveOrder: liveItems.map((item) => item.targetMediaId),
    nominations: generated.nominations,
    limit: run.request.expectedItemCount,
    projectionCapturedAt: generated.projectionCapturedAt,
    evaluatedAt: now,
    latencyMs,
    cohortQuality: generated.cohortQuality,
    rankingMode:
      (run.evaluation.manifestId === HYBRID_PERSONALIZED_MANIFEST_ID ||
        run.evaluation.manifestId === COWATCH_MMR_TRIAL_MANIFEST_ID) &&
      (run.evaluation.generatorVersion ===
        HYBRID_CANDIDATE_GENERATOR_SET_VERSION ||
        run.evaluation.generatorVersion === COWATCH_SHADOW_GENERATOR_KEY)
        ? "hybrid"
        : "semantic",
    viewingMode: generated.viewingMode,
    currentVideoId: run.request.seedMediaId,
    history,
  })

  const published = await prisma.$transaction(async (tx) => {
    // Match erasure's root-first ordering before taking the run, graph and
    // composition locks. A reset cannot hold the profile while we hold its graph.
    if (run.projectionProfileId) {
      const [profile] = await tx.$queryRaw<
        Array<{ state: string; privacyGeneration: number; expiresAt: Date }>
      >(Prisma.sql`
        SELECT state::text, privacy_generation AS "privacyGeneration", expires_at AS "expiresAt"
        FROM recommendation_profile WHERE id = ${run.projectionProfileId} FOR SHARE
      `)
      if (
        !profile ||
        profile.state !== "active" ||
        profile.privacyGeneration !== run.privacyGeneration ||
        profile.expiresAt <= now
      )
        return false
    }
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM recommendation_request WHERE id = ${run.requestId} FOR SHARE`,
    )
    const currentRun = await tx.recommendationShadowRun.findUnique({
      where: { id: run.id },
      select: {
        state: true,
        generation: true,
        claimId: true,
        evaluation: { select: { state: true, generation: true } },
      },
    })
    if (
      currentRun?.state !== RecommendationShadowRunState.CLAIMED ||
      currentRun.generation !== run.generation ||
      currentRun.claimId !== input.claimId ||
      currentRun.evaluation.state !==
        RecommendationShadowEvaluationState.ACTIVE ||
      currentRun.evaluation.generation !== input.expectedEvaluationGeneration
    ) {
      return false
    }
    const currentRequest = await tx.recommendationRequest.findUnique({
      where: { id: run.requestId },
      select: {
        state: true,
        items: {
          orderBy: [{ position: "asc" }, { id: "asc" }],
          take: MAX_SHADOW_ITEMS,
          select: { targetMediaId: true },
        },
      },
    })
    if (
      currentRequest?.state !== "ISSUED" ||
      digestIds(currentRequest.items.map((item) => item.targetMediaId)) !==
        projection.liveSlateDigest
    ) {
      return false
    }
    await tx.recommendationShadowNomination.deleteMany({
      where: { runId: run.id },
    })
    if (projection.nominations.length > 0) {
      await tx.recommendationShadowNomination.createMany({
        data: projection.nominations.map((nomination) => ({
          id: randomUUID(),
          runId: run.id,
          ordinal: nomination.ordinal,
          candidateKey: nomination.candidateKey.slice(0, 191),
          targetMediaId: nomination.targetMediaId.slice(0, 191),
          generator: nomination.generator,
          generatorVersion: nomination.generatorVersion,
          sourceRank: nomination.sourceRank,
          sourceScore: nomination.sourceScore,
          eligible: nomination.eligible,
          reasonCodes: nomination.reasonCodes,
          shadowPosition: nomination.shadowPosition,
          overlapsLive: nomination.overlapsLive,
          provenance: nomination.provenance,
          expiresAt: run.expiresAt,
        })),
      })
    }
    const update = await tx.recommendationShadowRun.updateMany({
      where: {
        id: run.id,
        state: RecommendationShadowRunState.CLAIMED,
        generation: run.generation,
        claimId: input.claimId,
      },
      data: {
        state: RecommendationShadowRunState.PUBLISHED,
        finishedAt: now,
        heartbeatAt: now,
        nominatedCount: projection.nominations.length,
        eligibleCount: projection.nominations.filter((row) => row.eligible)
          .length,
        rejectedCount: projection.nominations.filter((row) => !row.eligible)
          .length,
        liveSlateDigest: projection.liveSlateDigest,
        shadowSlateDigest: projection.shadowSlateDigest,
        liveSlateUnchanged: true,
        ...projection.metrics,
        latencyMs: projection.metrics.latencyMs,
        inputFreshnessMs: projection.metrics.inputFreshnessMs,
        failureReason: generated.sourceFailureReason?.slice(0, 64) ?? null,
      },
    })
    if (update.count === 1)
      await persistCompositionObservation(tx, {
        runId: run.id,
        observation: projection.compositionObservation,
        now,
      })
    return update.count === 1
  })
  if (!published) {
    await fenceShadowRun(
      prisma,
      run.id,
      run.generation,
      input.claimId,
      now,
      "late_claim_fenced",
    )
    return { status: "fenced", reason: "late_claim_fenced" }
  }
  return { status: "published", replay: false }
}

export async function completeShadowEvaluation(
  prisma: PrismaClient,
  input: {
    evaluationId: string
    expectedGeneration: number
    minimumRuns: number
    now?: Date
  },
): Promise<
  | Readonly<{ status: "decided"; decision: string; decisionId: string }>
  | Readonly<{ status: "fenced"; reason: string }>
> {
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const evaluation = await tx.recommendationShadowEvaluation.findUnique({
      where: { id: input.evaluationId },
      include: {
        decision: true,
        runs: {
          take: 10_001,
          orderBy: [{ sampleOrdinal: "asc" }, { id: "asc" }],
          select: {
            state: true,
            coverage: true,
            overlap: true,
            novelty: true,
            diversity: true,
            rejection: true,
            latencyMs: true,
            cohortQuality: true,
            inputFreshnessMs: true,
            liveSlateDigest: true,
            shadowSlateDigest: true,
            finishedAt: true,
          },
        },
      },
    })
    if (!evaluation)
      return { status: "fenced" as const, reason: "evaluation_missing" }
    if (evaluation.decision) {
      return {
        status: "decided" as const,
        decision: shadowDecisionName(evaluation.decision.decision),
        decisionId: evaluation.decision.id,
      }
    }
    if (
      evaluation.state !== RecommendationShadowEvaluationState.ACTIVE ||
      evaluation.generation !== input.expectedGeneration
    ) {
      return {
        status: "fenced" as const,
        reason: "evaluation_generation_changed",
      }
    }
    const published = evaluation.runs.filter(
      (run) => run.state === RecommendationShadowRunState.PUBLISHED,
    )
    const metrics = aggregateShadowMetrics(published)
    const policyDecision = decideShadowEvaluation({
      metrics,
      processedRuns: published.length,
      minimumRuns: input.minimumRuns,
    })
    if (evaluation.manifestId === COWATCH_MMR_TRIAL_MANIFEST_ID) {
      await tx.$queryRaw`SELECT set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`
    }
    const readinessFailure =
      evaluation.manifestId === COWATCH_MMR_TRIAL_MANIFEST_ID &&
      policyDecision.decision === "promote_to_experiment"
        ? evaluation.runs.length !== evaluation.sampledCount
          ? "cowatch_trial_sample_retention_incomplete"
          : evaluation.runs.length > evaluation.requestedSampleSize ||
              evaluation.runs.length > 500
            ? "cowatch_trial_sample_overflow"
            : await cowatchTrialCandidateReadiness(tx, evaluation, now)
        : "cowatch_controlled_evaluation_required"
    const decision =
      evaluation.generatorVersion === COWATCH_SHADOW_GENERATOR_KEY &&
      policyDecision.decision === "promote_to_experiment" &&
      readinessFailure
        ? {
            decision: "inconclusive" as const,
            reasonCode: readinessFailure,
            reevaluationCondition: "complete_feat_505_controlled_evaluation",
          }
        : policyDecision
    const slateDigests = published.map((run) => ({
      live: run.liveSlateDigest,
      shadow: run.shadowSlateDigest,
    }))
    const inputDigest = digestShadowValue(
      evaluation.cowatchGenerationId
        ? {
            manifestId: evaluation.manifestId,
            generatorVersion: evaluation.generatorVersion,
            samplingVersion: evaluation.samplingVersion,
            cowatchGenerationId: evaluation.cowatchGenerationId,
            slates: slateDigests,
          }
        : slateDigests,
    )
    const decisionRow = await tx.recommendationShadowDecision.create({
      data: {
        evaluationId: evaluation.id,
        decision: shadowDecisionEnum(decision.decision),
        reasonCode: decision.reasonCode,
        reevaluationCondition: decision.reevaluationCondition,
        inputDigest,
        decidedAt: now,
        expiresAt: evaluation.expiresAt,
      },
    })
    const inputWatermark = latestShadowDate(
      published
        .map((run) => run.finishedAt)
        .filter((value): value is Date => value != null),
    )
    const update = await tx.recommendationShadowEvaluation.updateMany({
      where: {
        id: evaluation.id,
        state: RecommendationShadowEvaluationState.ACTIVE,
        generation: input.expectedGeneration,
      },
      data: {
        state: RecommendationShadowEvaluationState.TERMINAL,
        sampledCount:
          evaluation.manifestId === COWATCH_MMR_TRIAL_MANIFEST_ID
            ? evaluation.sampledCount
            : evaluation.runs.length,
        processedCount: published.length,
        failedCount: evaluation.runs.filter(
          (run) => run.state === RecommendationShadowRunState.FAILED,
        ).length,
        fencedCount: evaluation.runs.filter(
          (run) => run.state === RecommendationShadowRunState.FENCED,
        ).length,
        coverage: metrics.coverage,
        overlap: metrics.overlap,
        novelty: metrics.novelty,
        diversity: metrics.diversity,
        rejection: metrics.rejection,
        latencyP95Ms: metrics.latencyMs,
        cohortQuality: metrics.cohortQuality,
        inputFreshnessP95Ms: metrics.inputFreshnessMs,
        inputWatermark,
        inputDigest,
      },
    })
    if (update.count !== 1) {
      throw new RecommendationInternalStateError("shadow_evaluation_fenced")
    }
    return {
      status: "decided" as const,
      decision: decision.decision,
      decisionId: decisionRow.id,
    }
  })
}

export async function redactShadowRunsForProfileGeneration(
  tx: Pick<
    Prisma.TransactionClient,
    "recommendationShadowRun" | "recommendationShadowNomination"
  >,
  input: { profileId: string; privacyGeneration: number; now?: Date },
): Promise<number> {
  const runs = await tx.recommendationShadowRun.findMany({
    where: {
      projectionProfileId: input.profileId,
      privacyGeneration: input.privacyGeneration,
    },
    select: { id: true },
  })
  if (runs.length === 0) return 0
  const ids = runs.map(({ id }) => id)
  await tx.recommendationShadowNomination.deleteMany({
    where: { runId: { in: ids } },
  })
  const result = await tx.recommendationShadowRun.updateMany({
    where: { id: { in: ids } },
    data: {
      state: RecommendationShadowRunState.FENCED,
      generation: { increment: 1 },
      claimId: null,
      projectionProfileId: null,
      privacyGeneration: null,
      contextProjectionRef: null,
      contextProjectionDigest: null,
      failureReason: "profile_generation_revoked",
      finishedAt: input.now ?? new Date(),
    },
  })
  return result.count
}

async function fenceShadowRun(
  prisma: PrismaClient,
  runId: string,
  generation: number,
  claimId: string,
  now: Date,
  reason: string,
): Promise<void> {
  await prisma.recommendationShadowRun.updateMany({
    where: {
      id: runId,
      generation,
      claimId,
      state: RecommendationShadowRunState.CLAIMED,
    },
    data: {
      state: RecommendationShadowRunState.FENCED,
      failureReason: reason.slice(0, 64),
      finishedAt: now,
      heartbeatAt: now,
    },
  })
}

async function redactAndFenceShadowRun(
  prisma: PrismaClient,
  runId: string,
  input: { generation: number; claimId: string; now: Date; reason: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.recommendationShadowNomination.deleteMany({ where: { runId } })
    await tx.recommendationShadowRun.updateMany({
      where: {
        id: runId,
        generation: input.generation,
        claimId: input.claimId,
        state: RecommendationShadowRunState.CLAIMED,
      },
      data: {
        state: RecommendationShadowRunState.FENCED,
        generation: { increment: 1 },
        claimId: null,
        projectionProfileId: null,
        privacyGeneration: null,
        contextProjectionRef: null,
        contextProjectionDigest: null,
        failureReason: input.reason,
        finishedAt: input.now,
        heartbeatAt: input.now,
      },
    })
  })
}
