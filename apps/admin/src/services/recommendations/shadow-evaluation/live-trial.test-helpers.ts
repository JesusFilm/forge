import { createHash, randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { expect } from "vitest"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "../integrity-policy"
import { publishCowatchShadowGeneration } from "../cowatch/projection.service"
const day = 86_400_000
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")
/** Synthetic source data in the caller's guarded, disposable native fixture. */
export async function seedLiveTrialGraph(prisma: PrismaClient) {
  const id = `live-trial-${randomUUID()}`
  const created = new Date()
  const start = new Date(created.getTime() - 10 * day)
  const expiresAt = new Date(created.getTime() + 20 * day)
  const mediaA = `${id}-A`,
    mediaB = `${id}-B`,
    mediaC = `${id}-C`
  const profileId = `${id}-profile`
  await prisma.recommendationProfile.create({
    data: {
      id: profileId,
      privacyGeneration: 1,
      tokenDigest: digest(profileId),
      choice: "DURABLE_ALLOWED",
      expiresAt,
    },
  })
  await prisma.recommendationProfileSessionLink.create({
    data: {
      profileId,
      privacyGeneration: 1,
      sessionDigest: digest(`${id}-viewer-0`),
      expiresAt: new Date(created.getTime() + 60_000),
    },
  })
  const episodes: string[] = []
  for (let viewer = 0; viewer < 10; viewer++) {
    for (const [index, mediaId] of (viewer < 5
      ? [mediaA, mediaB]
      : [mediaC]
    ).entries()) {
      const episodeId = `${id}-episode-${viewer}-${index}`
      const occurredAt = new Date(start.getTime() + index * 1_000)
      episodes.push(episodeId)
      await prisma.recommendationPlaybackEpisode.create({
        data: {
          id: episodeId,
          mediaId,
          sessionDigest: digest(`${id}-viewer-${viewer}`),
          state: "FINALIZED",
          nextFactSequence: 2,
          activeUntil: new Date(created.getTime() + day),
          hardUntil: new Date(created.getTime() + 2 * day),
          finalizedAt: occurredAt,
          claimedAt: occurredAt,
          createdAt: occurredAt,
          expiresAt,
        },
      })
      await prisma.recommendationOutcomeRevision.create({
        data: {
          id: `${episodeId}-r1`,
          episodeId,
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: 1,
          inputDigest: digest(episodeId),
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
      await prisma.recommendationEligibilityDecision.create({
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
          inputDigest: digest(`${episodeId}-eligible`),
          expiresAt,
        },
      })
    }
  }
  const sourceWindow = {
    version: "episode-event-window-v1" as const,
    windowStart: start,
    windowEnd: new Date(start.getTime() + 3_600_000),
    evaluationAsOf: created,
  }
  const publication = await publishCowatchShadowGeneration(
    prisma,
    created,
    sourceWindow,
  )
  expect(publication.status).toBe("published")
  const graphGenerationId = publication.generation!
  return {
    id,
    sessionDigest: digest(`${id}-viewer-0`),
    created,
    expiresAt,
    profileId,
    graphGenerationId,
    sourceWindow,
    mediaA,
    mediaB,
    mediaC,
    episodes,
    publication,
  }
}
