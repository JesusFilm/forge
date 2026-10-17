import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { expect } from "vitest"
import { seedLiveTrialGraph } from "./shadow-evaluation/live-trial.test-helpers"
import { playableCompositionGraph } from "./composition/graph.test-fixture"
import { context, nominations, thresholds } from "./composition/test-helpers"
import { compositionDigest } from "./composition/policy"
import { MMR_SLATE_POLICY_VERSION } from "./composition/mmr"
import {
  prepareCompositionProtocol,
  decideCompositionProtocol,
  recordCompositionCalibration,
  resolveCompositionQualification,
  type CompositionBinding,
} from "./composition/service"
import { COWATCH_SHADOW_GENERATOR_KEY } from "./cowatch/graph"
import { loadValidatedCowatchProfileInterests } from "./cowatch/inspection.service"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "./integrity-policy"
import { COWATCH_MMR_TRIAL_MANIFEST } from "./promotion/manifest"
import {
  createShadowEvaluation,
  sampleProfileShadowEvaluationContexts,
  claimNextShadowRun,
  executeClaimedShadowRun,
  completeShadowEvaluation,
} from "./shadow-evaluation/service"
import { bundleFixtureActor } from "./delivery-bundle-calibration.test-helper"

/** Real finite graph, current catalog and exact source-backed profile interest. */
export async function seedApprovedBundleGraph(db: PrismaClient) {
  const graph = await seedLiveTrialGraph(db)
  await playableCompositionGraph(db, {
    ...graph,
    generationId: graph.graphGenerationId,
    now: graph.created,
  })
  const projection = await db.recommendationProfileProjectionGeneration.create({
    data: {
      manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
      scope: "DURABLE",
      profileId: graph.profileId,
      privacyGeneration: 1,
      generation: 1,
      state: "BUILDING",
      projectionVersion: "multi-interest-profile-projection-v1",
      clusteringVersion: "deterministic-farthest-first-medoids-v1",
      eligibilityPolicyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
      outcomeClassifierVersion: "active-watch-proxy-v1",
      inputWindowStart: graph.sourceWindow.windowStart,
      inputWindowEnd: graph.sourceWindow.windowEnd,
      inputDigest: compositionDigest(randomUUID()),
      contributionCount: 1,
      durableInterestCount: 1,
      cohortQuality: 1,
      retentionDays: 180,
      expiresAt: graph.expiresAt,
    },
  })
  const episodeId = graph.episodes[0]!
  await db.recommendationProfileProjectionContribution.create({
    data: {
      generationId: projection.id,
      kind: "QUALIFIED_OUTCOME",
      sourceIdDigest: compositionDigest(episodeId),
      sourceOutcomeId: `${episodeId}-r1`,
      sourceEligibilityDecisionId: `${episodeId}-eligible`,
      sourceEligibilityRevision: 1,
      targetMediaId: graph.mediaA,
      interestOrdinal: 0,
      weight: 1,
      eligibilityPolicyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
      outcomeClassifierVersion: "active-watch-proxy-v1",
      privacyGeneration: 1,
      occurredAt: graph.sourceWindow.windowStart,
      expiresAt: graph.expiresAt,
    },
  })
  const embedding = `[${[1, ...Array<number>(1535).fill(0)].join(",")}]`
  await db.$executeRaw`
    INSERT INTO recommendation_profile_interest
      (id, generation_id, kind, interest_ordinal, medoid_media_id, medoid_source_digest, embedding, weight, support_count, stability, expires_at)
    VALUES (${randomUUID()}, ${projection.id}, 'durable', 0, ${graph.mediaA}, ${compositionDigest(episodeId)}, ${embedding}::vector, 1, 1, 1, ${graph.expiresAt})
  `
  const publishedAt = new Date()
  await db.recommendationProfileProjectionGeneration.update({
    where: { id: projection.id },
    data: { state: "PUBLISHED", publishedAt },
  })
  await db.recommendationProfileProjectionPointer.create({
    data: {
      scopeDigest: compositionDigest(projection.id),
      scope: "DURABLE",
      profileId: graph.profileId,
      privacyGeneration: 1,
      generationId: projection.id,
      pointerGeneration: 1,
    },
  })
  expect(
    await loadValidatedCowatchProfileInterests(db, projection.id, new Date()),
  ).toEqual([
    { mediaId: graph.mediaA, kind: "durable", interestOrdinal: 0, weight: 1 },
  ])
  const requestAt = new Date()
  const candidates = nominations().map((row, index) =>
    index === 0
      ? {
          ...row,
          targetMediaId: graph.mediaB,
          canonicalIdentity: {
            ...row.canonicalIdentity,
            videoId: graph.mediaB,
            videoCoreId: graph.mediaB,
          },
          source: {
            ...row.source,
            generator: "directional-cowatch",
            generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
            evidence: {
              ...row.source.evidence,
              generation: graph.graphGenerationId,
            },
          },
        }
      : row,
  )
  const request = await db.recommendationRequest.create({
    data: {
      manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
      contractVersion: "semantic-recommendation-v1",
      surfaceVersion: context.surface,
      strategyVersion: COWATCH_MMR_TRIAL_MANIFEST.strategyVersion,
      classifierVersion: "active-watch-proxy-v1",
      sessionDigest: graph.sessionDigest,
      locale: "en",
      seedMediaId: graph.mediaA,
      expectedItemCount: 2,
      state: "ISSUED",
      result: "SERVED",
      signingKid: "native-bundle-fixture",
      deliveryJti: randomUUID(),
      issuedAt: requestAt,
      createdAt: requestAt,
      expiresAt: graph.expiresAt,
      items: {
        create: candidates.slice(0, 2).map((row, position) => ({
          position,
          targetMediaId: row.targetMediaId,
          canonicalHref: `/watch/${row.targetMediaId}.html`,
          candidateGenerator: "semantic",
          candidateProvenance: {},
          capabilityJti: randomUUID(),
          signingKid: "fixture",
          presentation: row.presentation,
          createdAt: requestAt,
          expiresAt: graph.expiresAt,
        })),
      },
      candidateRun: {
        create: {
          purpose: "watch",
          contextVersion: "recommendation-context-v1",
          generatorVersion: "fixture-retrieval-v1",
          unionVersion: "canonical-video-union-v1",
          eligibilityVersion: "watch-playable-locale-v1",
          rankerVersion: "fixture",
          composerVersion: "fixture",
          candidateEligibilityParity: "passed",
          rankerParity: "passed",
          nominatedCount: 2,
          canonicalizedCount: 2,
          deduplicatedCount: 0,
          rejectedCount: 0,
          scoredCount: 2,
          orderedCount: 2,
          composedCount: 2,
          evidenceComplete: true,
          createdAt: requestAt,
          expiresAt: graph.expiresAt,
        },
      },
    },
  })
  let now = new Date()
  const evaluationId = randomUUID(),
    protocolId = randomUUID()
  const operator = { actor: bundleFixtureActor, authenticatedAt: now }
  const protocol = await prepareCompositionProtocol(
    db,
    operator,
    {
      protocolId,
      shadowEvaluationId: evaluationId,
      sourceManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
      challengerManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
      generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
      cowatchGenerationId: graph.graphGenerationId,
      thresholds,
    },
    now,
  )
  await createShadowEvaluation(db, {
    evaluationId,
    manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
    generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
    contextVersion: "recommendation-context-v1",
    eligibilityVersion: "watch-playable-locale-v1",
    cowatchGenerationId: graph.graphGenerationId,
    windowStart: new Date(requestAt.getTime() - 1),
    windowEnd: new Date(requestAt.getTime() + 1),
    requestedSampleSize: 500,
    now,
  })
  expect(
    await sampleProfileShadowEvaluationContexts(db, {
      evaluationId,
      expectedGeneration: 1,
      now,
    }),
  ).toMatchObject({ status: "sampled", sampledCount: 1 })
  const claim = await claimNextShadowRun(db, {
    evaluationId,
    expectedGeneration: 1,
    now,
  })
  if (claim.status !== "claimed")
    throw new Error("Native bundle shadow claim missing")
  const run = await db.recommendationShadowRun.findUniqueOrThrow({
    where: { id: claim.runId },
  })
  expect(run.requestId).toBe(request.id)
  expect(run.contextProjectionRef).toBe(projection.id)
  expect(
    await executeClaimedShadowRun(db, {
      runId: claim.runId,
      expectedRunGeneration: claim.generation,
      expectedEvaluationGeneration: 1,
      claimId: claim.claimId,
      now,
      // Deterministic retrieval inputs only. Claim, graph validation, composition
      // observation, publication and both approval decisions execute real services.
      generator: async () => ({
        nominations: candidates,
        cohortQuality: 1,
        projectionCapturedAt: publishedAt,
      }),
    }),
  ).toMatchObject({ status: "published" })
  // Terminal evidence must follow the database-created evaluation timestamp.
  now = new Date()
  expect(
    await completeShadowEvaluation(db, {
      evaluationId,
      expectedGeneration: 1,
      minimumRuns: 1,
      now,
    }),
  ).toMatchObject({ status: "decided", decision: "promote_to_experiment" })
  const shadowDecision =
    await db.recommendationShadowDecision.findUniqueOrThrow({
      where: { evaluationId },
    })
  const decision = await decideCompositionProtocol(
    db,
    operator,
    protocolId,
    now,
  )
  expect(decision.decision).toBe("qualify_for_controlled_study")
  const review = await recordCompositionCalibration(
    db,
    operator,
    {
      protocolId,
      configDigest: protocol.configDigest,
      evidenceDigest: decision.evidenceDigest,
      rationale:
        "Synthetic local integration fixture only; no production calibration or usefulness claim.",
    },
    now,
  )
  const composition: CompositionBinding = {
    protocolId,
    manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
    composerVersion: MMR_SLATE_POLICY_VERSION,
    configDigest: protocol.configDigest,
    evidenceDigest: decision.evidenceDigest,
    reviewDigest: review.reviewDigest,
    authorityRevision: 1,
    cowatchGenerationId: graph.graphGenerationId,
  }
  const qualification = await resolveCompositionQualification(
    db,
    composition,
    now,
  )
  expect(qualification).not.toBeNull()
  const generation = await db.recommendationCowatchGeneration.findUniqueOrThrow(
    { where: { id: graph.graphGenerationId } },
  )
  return {
    graph,
    projection: { ...projection, publishedAt },
    evaluationId,
    shadowDecisionId: shadowDecision.id,
    composition,
    generation,
    compositionValidUntil: qualification!.validUntil,
  }
}
