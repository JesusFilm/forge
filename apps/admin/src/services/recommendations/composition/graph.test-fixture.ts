import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import {
  buildCowatchGraph,
  COWATCH_DURABLE_LINEAGE_VERSION,
  type CowatchOutcome,
} from "../cowatch/graph"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "../integrity-policy"
import { compositionDigest } from "./policy"
let ordinal = 0
const day = 86_400_000

/** Historical graph fixture for real retention/privacy constraints. Production
 * publication is retired; fixture rows are created directly in the owned DB. */
export async function compositionGraphFixture(
  db: PrismaClient,
  request?: {
    id: string
    expiresAt: Date
    itemId: string
    mediaId: string
    selectionId: string
  },
) {
  const id = randomUUID()
  const now = new Date()
  const start = new Date(now.getTime() - 10 * day + ordinal++ * 3_600_000)
  const expiresAt = request?.expiresAt ?? new Date(now.getTime() + 15 * day)
  const mediaA = request?.mediaId ?? `${id}-a`,
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
  const outcomes: CowatchOutcome[] = []
  const privateOutcomes = new Set<string>()
  for (let viewer = 0; viewer < 10; viewer++) {
    for (const [position, mediaId] of (viewer < 5
      ? [mediaA, mediaB]
      : [mediaC]
    ).entries()) {
      const episodeId = `${id}-${viewer}-${position}`
      const occurredAt = new Date(start.getTime() + position * 1_000)
      const requestLineage =
        request && viewer === 0 && position === 0
          ? { requestId: request.id, itemId: request.itemId }
          : {}
      await db.recommendationPlaybackEpisode.create({
        data: {
          id: episodeId,
          ...requestLineage,
          selectionId: requestLineage.requestId
            ? request?.selectionId
            : undefined,
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
          ...requestLineage,
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
      const outcomeId = `${episodeId}-r1`
      if (viewer === 0) privateOutcomes.add(outcomeId)
      outcomes.push({
        outcomeId,
        episodeId,
        revision: 1,
        mediaId,
        sessionDigest: compositionDigest(`${id}-${viewer}`),
        viewerKey:
          viewer === 0
            ? `profile:${profile.id}:1`
            : `session:${compositionDigest(`${id}-${viewer}`)}`,
        occurredAt,
        qualified: true,
        finalized: true,
        integrityEligible: true,
        eligibilityDecisionId: `${episodeId}-eligible`,
        eligibilityRevision: 1,
        eligibilityPolicyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
        qualityWeight: 1,
        expiresAt,
      })
    }
  }
  const window = {
    version: "episode-event-window-v1" as const,
    windowStart: start,
    windowEnd: new Date(start.getTime() + 1_800_000),
    evaluationAsOf: now,
  }
  const graph = buildCowatchGraph(
    outcomes,
    now,
    window,
    COWATCH_DURABLE_LINEAGE_VERSION,
  )
  const graphExpiry = new Date(now.getTime() + 29 * day)
  await db.$transaction(async (tx) => {
    await tx.recommendationCowatchGeneration.create({
      data: {
        id: graph.generation,
        projectionVersion: graph.projectionVersion,
        featureVersion: graph.featureVersion,
        lineageVersion: COWATCH_DURABLE_LINEAGE_VERSION,
        sourceCount: graph.qualifiedOutcomes,
        contributionCount: graph.contributions.length,
        edgeCount: graph.edges.length,
        distinctViewerCount: graph.uniqueViewers,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        evaluationAsOf: now,
        sourceWindowVersion: window.version,
        rawSourceCount: outcomes.length,
        attemptedPairCount: graph.attemptedPairCount,
        terminalDecision: "no_promotion",
        decisionReason: "historical_retention_fixture",
        publishedAt: now,
        expiresAt: graphExpiry,
      },
    })
    await tx.recommendationCowatchSourceContribution.createMany({
      data: graph.sources.map((row) => ({
        id: randomUUID(),
        generationId: graph.generation,
        outcomeId: row.outcomeId,
        eligibilityDecisionId: row.eligibilityDecisionId!,
        eligibilityRevision: row.eligibilityRevision!,
        eligibilityPolicyVersion: row.eligibilityPolicyVersion!,
        viewerProfileId: privateOutcomes.has(row.outcomeId) ? profile.id : null,
        viewerPrivacyGeneration: privateOutcomes.has(row.outcomeId) ? 1 : null,
        mediaId: row.mediaId,
        sessionDigest: row.sessionDigest,
        viewerKeyDigest: compositionDigest(row.viewerKey),
        qualityWeight: row.qualityWeight,
        occurredAt: row.occurredAt,
        expiresAt: row.expiresAt < graphExpiry ? row.expiresAt : graphExpiry,
      })),
    })
    await tx.recommendationCowatchContribution.createMany({
      data: graph.contributions.map((row) => ({
        id: randomUUID(),
        generationId: graph.generation,
        sourceOutcomeId: row.sourceOutcomeId,
        targetOutcomeId: row.targetOutcomeId,
        viewerProfileId: privateOutcomes.has(row.sourceOutcomeId)
          ? profile.id
          : null,
        sourceMediaId: row.sourceMediaId,
        targetMediaId: row.targetMediaId,
        sessionDigest: row.sessionDigest,
        viewerKeyDigest: compositionDigest(row.viewerKey),
        gapMs: row.gapMs,
        qualityWeight: row.qualityWeight,
        recencyWeight: row.recencyWeight,
        effectiveWeight: row.effectiveWeight,
        expiresAt: graphExpiry,
      })),
    })
    await tx.recommendationCowatchEdge.createMany({
      data: graph.edges.map((edge) => ({
        id: randomUUID(),
        generationId: graph.generation,
        sourceMediaId: edge.sourceMediaId,
        targetMediaId: edge.targetMediaId,
        sessionSupport: edge.sessionSupport,
        distinctViewerSupport: edge.distinctViewerSupport,
        confidence: edge.confidence,
        popularityCorrectedLift: edge.popularityCorrectedLift,
        recencyWeight: edge.recencyWeight,
        qualityWeight: edge.qualityWeight,
        effectiveWeight: edge.effectiveWeight,
        contamination: edge.contamination,
        eligible: edge.eligible,
      })),
    })
  })
  return {
    mediaA,
    mediaB,
    mediaC,
    generationId: graph.generation,
    profileId: profile.id,
    now: new Date(now.getTime() + 1000),
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
