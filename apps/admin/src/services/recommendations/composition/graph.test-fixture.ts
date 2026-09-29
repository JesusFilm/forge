import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { publishCowatchShadowGeneration } from "../cowatch/projection.service"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "../integrity-policy"
import { compositionDigest } from "./policy"
let ordinal = 0
const day = 86_400_000

/** Actual finite projection from eligible outcomes in an owned disposable DB. */
export async function compositionGraphFixture(db: PrismaClient) {
  const id = randomUUID()
  const now = new Date()
  const start = new Date(now.getTime() - 10 * day + ordinal++ * 3_600_000)
  const expiresAt = new Date(now.getTime() + 15 * day)
  const profile = await db.recommendationProfile.create({
    data: {
      tokenDigest: compositionDigest(id),
      privacyGeneration: 1,
      choice: "DURABLE_ALLOWED",
      expiresAt,
    },
  })
  await db.recommendationProfileSessionLink.create({
    data: {
      profileId: profile.id,
      privacyGeneration: 1,
      sessionDigest: compositionDigest(`${id}-0`),
      expiresAt,
    },
  })
  for (let viewer = 0; viewer < 10; viewer++) {
    for (const [position, mediaId] of (viewer < 5
      ? ["a", "b"]
      : ["c"]
    ).entries()) {
      const episodeId = `${id}-${viewer}-${position}`
      const occurredAt = new Date(start.getTime() + position * 1_000)
      await db.recommendationPlaybackEpisode.create({
        data: {
          id: episodeId,
          mediaId,
          sessionDigest: compositionDigest(`${id}-${viewer}`),
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
  const publication = await publishCowatchShadowGeneration(db, now, {
    version: "episode-event-window-v1",
    windowStart: start,
    windowEnd: new Date(start.getTime() + 1_800_000),
    evaluationAsOf: now,
  })
  if (
    publication.status !== "published" ||
    !publication.generation ||
    !publication.publishedAt
  )
    throw new Error("Owned composition graph publication failed")
  return {
    generationId: publication.generation,
    profileId: profile.id,
    now: new Date(publication.publishedAt.getTime() + 1000),
    expiresAt,
  }
}
