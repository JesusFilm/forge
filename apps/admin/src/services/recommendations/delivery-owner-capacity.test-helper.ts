import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { playableCompositionGraph } from "./composition/graph.test-fixture"
import { compositionDigest } from "./composition/policy"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "./integrity-policy"
import { OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID } from "./promotion/manifest"

/** Owned synthetic source population: five sessions A→12 targets plus five
 * singleton sessions. No fabricated edges, graph authority or study evidence. */
export async function seedOwnerCapacityPopulation(db: PrismaClient) {
  const id = randomUUID(),
    now = new Date(),
    day = 86_400_000
  const start = new Date(now.getTime() - 10 * day)
  const expiresAt = new Date(now.getTime() + 20 * day)
  const mediaA = `${id}-anchor`,
    mediaC = `${id}-singleton`
  const targets = Array.from(
    { length: 12 },
    (_, index) => `${id}-target-${String(index).padStart(3, "0")}`,
  )
  const profile = await db.recommendationProfile.create({
    data: {
      id: `${id}-profile`,
      tokenDigest: compositionDigest(`${id}-profile`),
      privacyGeneration: 1,
      choice: "DURABLE_ALLOWED",
      expiresAt,
    },
  })
  const sessionDigest = compositionDigest(`${id}-viewer-0`)
  await db.recommendationProfileSessionLink.create({
    data: {
      profileId: profile.id,
      privacyGeneration: 1,
      sessionDigest,
      expiresAt,
    },
  })
  let firstEpisodeId = ""
  for (let viewer = 0; viewer < 10; viewer++) {
    for (const [index, mediaId] of (viewer < 5
      ? [mediaA, ...targets]
      : [mediaC]
    ).entries()) {
      const episodeId = `${id}-episode-${viewer}-${String(index).padStart(3, "0")}`
      if (viewer === 0 && index === 0) firstEpisodeId = episodeId
      const occurredAt = new Date(start.getTime() + index * 1_000)
      await db.recommendationPlaybackEpisode.create({
        data: {
          id: episodeId,
          mediaId,
          sessionDigest: compositionDigest(`${id}-viewer-${viewer}`),
          state: "FINALIZED",
          nextFactSequence: 2,
          activeUntil: new Date(now.getTime() + day),
          hardUntil: new Date(now.getTime() + 2 * day),
          finalizedAt: occurredAt,
          claimedAt: occurredAt,
          createdAt: occurredAt,
          expiresAt,
        },
      })
      await db.recommendationOutcomeRevision.create({
        data: {
          id: `${episodeId}-r1`,
          episodeId,
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: 1,
          inputDigest: compositionDigest(episodeId),
          revision: 1,
          qualifiedView: true,
          viewQualityWeight: 1,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: 30_000,
          durationSeconds: 30,
          durationCohort: "short",
          activeCoverage: "complete",
          generation: 1,
          createdAt: occurredAt,
          expiresAt,
        },
      })
      await db.recommendationEligibilityDecision.create({
        data: {
          id: `${episodeId}-eligible`,
          sourceType: "PLAYBACK_OUTCOME",
          sourceKey: episodeId,
          outcomeId: `${episodeId}-r1`,
          policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
          revision: 1,
          actorClass: "HUMAN_SIGNED_IN",
          state: "ELIGIBLE",
          eligibleScopes: ["aggregate", "profile"],
          contributionWeight: 1,
          contributionOrdinal: 1,
          distinctSupport: 10,
          identityConcentration: 0.1,
          inputDigest: compositionDigest(`${episodeId}-eligible`),
          expiresAt,
        },
      })
    }
  }
  for (const [index, mediaB] of targets.entries()) {
    await playableCompositionGraph(db, {
      mediaA,
      mediaB,
      mediaC,
      generationId: "catalog-only",
      profileId: profile.id,
      now,
      expiresAt,
    })
    await db.videoLocale.updateMany({
      where: { videoId: mediaB, locale: "en" },
      data: {
        title: `Capacity graph target ${String(index).padStart(3, "0")}`,
      },
    })
  }
  const sourceWindow = {
    version: "episode-event-window-v1" as const,
    windowStart: start,
    windowEnd: new Date(start.getTime() + 3_600_000),
    evaluationAsOf: new Date(),
  }
  const projection = await db.recommendationProfileProjectionGeneration.create({
    data: {
      manifestId: OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
      scope: "DURABLE",
      profileId: profile.id,
      privacyGeneration: 1,
      generation: 1,
      state: "BUILDING",
      projectionVersion: "multi-interest-profile-projection-v1",
      clusteringVersion: "deterministic-farthest-first-medoids-v1",
      eligibilityPolicyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
      outcomeClassifierVersion: "active-watch-proxy-v1",
      inputWindowStart: sourceWindow.windowStart,
      inputWindowEnd: sourceWindow.windowEnd,
      inputDigest: compositionDigest(id),
      contributionCount: 1,
      durableInterestCount: 1,
      cohortQuality: 1,
      retentionDays: 180,
      expiresAt,
    },
  })
  await db.recommendationProfileProjectionContribution.create({
    data: {
      generationId: projection.id,
      kind: "QUALIFIED_OUTCOME",
      sourceIdDigest: compositionDigest(firstEpisodeId),
      sourceOutcomeId: `${firstEpisodeId}-r1`,
      sourceEligibilityDecisionId: `${firstEpisodeId}-eligible`,
      sourceEligibilityRevision: 1,
      targetMediaId: mediaA,
      interestOrdinal: 0,
      weight: 1,
      eligibilityPolicyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
      outcomeClassifierVersion: "active-watch-proxy-v1",
      privacyGeneration: 1,
      occurredAt: start,
      expiresAt,
    },
  })
  const embedding = `[${[1, ...Array<number>(1535).fill(0)].join(",")}]`
  await db.$executeRaw`INSERT INTO recommendation_profile_interest
    (id, generation_id, kind, interest_ordinal, medoid_media_id, medoid_source_digest, embedding, weight, support_count, stability, expires_at)
    VALUES (${randomUUID()}, ${projection.id}, 'durable', 0, ${mediaA}, ${compositionDigest(firstEpisodeId)}, ${embedding}::vector, 1, 1, 1, ${expiresAt})`
  const publishedAt = new Date()
  await db.recommendationProfileProjectionGeneration.update({
    where: { id: projection.id },
    data: { state: "PUBLISHED", publishedAt },
  })
  await db.recommendationProfileProjectionPointer.create({
    data: {
      scopeDigest: compositionDigest(projection.id),
      scope: "DURABLE",
      profileId: profile.id,
      privacyGeneration: 1,
      generationId: projection.id,
      pointerGeneration: 1,
    },
  })
  const consentReceiptDigest = compositionDigest(`${id}-receipt`)
  await db.recommendationConsentReceipt.create({
    data: {
      tokenDigest: consentReceiptDigest,
      contractVersion: "recommendation-consent-v1",
      choice: "PERSONALIZATION",
      state: "ACTIVE",
      profileId: profile.id,
      privacyGeneration: 1,
      expiresAt,
    },
  })
  return {
    mediaA,
    targets,
    profile,
    sessionDigest,
    sourceWindow,
    projection: { ...projection, publishedAt },
    consentReceiptDigest,
    expiresAt,
  }
}
