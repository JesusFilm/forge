import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { expect } from "vitest"
import { seedLiveTrialGraph } from "./shadow-evaluation/live-trial.test-helpers"
import { playableCompositionGraph } from "./composition/graph.test-fixture"
import { compositionDigest } from "./composition/policy"
import { loadValidatedCowatchProfileInterests } from "./cowatch/inspection.service"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "./integrity-policy"
import { OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID } from "./promotion/manifest"

/** Synthetic retained sources and current catalog/profile only: no study,
 * calibration, shadow evaluation, composition protocol or fabricated decision.
 */
export async function seedOwnerDeliveryGraph(db: PrismaClient) {
  const graph = await seedLiveTrialGraph(db)
  await playableCompositionGraph(db, {
    ...graph,
    generationId: graph.graphGenerationId,
    now: graph.created,
  })
  const projection = await db.recommendationProfileProjectionGeneration.create({
    data: {
      manifestId: OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
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
  const consentReceiptDigest = compositionDigest(`${graph.profileId}-receipt`)
  await db.recommendationConsentReceipt.create({
    data: {
      tokenDigest: consentReceiptDigest,
      contractVersion: "recommendation-consent-v1",
      choice: "PERSONALIZATION",
      state: "ACTIVE",
      profileId: graph.profileId,
      privacyGeneration: 1,
      expiresAt: graph.expiresAt,
    },
  })
  return {
    graph,
    projection: { ...projection, publishedAt },
    consentReceiptDigest,
  }
}
