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
  const mediaA = `${id}-a`,
    mediaB = `${id}-b`,
    mediaC = `${id}-c`
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
      ? [mediaA, mediaB]
      : [mediaC]
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
    mediaA,
    mediaB,
    mediaC,
    generationId: publication.generation,
    profileId: profile.id,
    now: new Date(publication.publishedAt.getTime() + 1000),
    expiresAt,
  }
}

/** Current catalog hydration consumed by the real U5 live source. */
export async function playableCompositionGraph(
  db: PrismaClient,
  graph: Awaited<ReturnType<typeof compositionGraphFixture>>,
) {
  const id = randomUUID()
  const language = await db.language.upsert({
    where: { slug: "english" },
    create: { id: `${id}-language`, coreId: `${id}-language`, slug: "english" },
    update: {},
  })
  await db.video.create({
    data: { id: graph.mediaB, coreId: graph.mediaB, slug: graph.mediaB },
  })
  await db.videoLocale.create({
    data: {
      videoId: graph.mediaB,
      locale: "en",
      title: "Owned live co-watch fixture",
      languageSlug: "english",
      status: "PUBLISHED",
    },
  })
  const mux = await db.muxVideo.create({
    data: { id: `${id}-mux`, playbackId: `${id}-playback` },
  })
  const edition = await db.videoEdition.create({
    data: {
      id: `${id}-edition`,
      coreId: `${id}-edition`,
      name: "Owned fixture",
    },
  })
  const pointer = await db.contentEmbeddingContractPointer.findUniqueOrThrow({
    where: { id: "content-embedding-contract-pointer" },
    include: { activeContract: true },
  })
  const contract = pointer.activeContract!
  const transcript = await db.videoTranscript.create({
    data: {
      videoEditionId: edition.id,
      videoId: graph.mediaB,
      language: "en",
      model: contract.storageModel,
      dimensions: contract.storageDimensions,
      embeddingProvider: contract.storageProvider,
      embeddingNativeDimensions: contract.storageNativeDimensions,
      embeddingTransformVersion: contract.storageTransformVersion,
      chunkingType: "fixture",
      maxChunkTokens: 100,
      overlapTokens: 0,
      totalChunks: 1,
      totalTokens: 10,
      generatedAt: graph.now,
    },
  })
  await db.videoTranscriptChunk.create({
    data: {
      transcriptId: transcript.id,
      language: "en",
      chunkIndex: 0,
      chunkId: "first",
      text: "Owned current transcript",
      tokenCount: 10,
      model: contract.storageModel,
      dimensions: contract.storageDimensions,
      feltNeeds: ["hope"],
    },
  })
  await db.videoDub.create({
    data: {
      coreId: `${id}-dub`,
      videoId: graph.mediaB,
      videoEditionId: edition.id,
      languageId: language.id,
      muxVideoId: mux.id,
      published: true,
      duration: 120,
    },
  })
}
