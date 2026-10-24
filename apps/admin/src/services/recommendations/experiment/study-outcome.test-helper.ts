import { createHash, randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"

/** Synthetic joined outcome fixture; calibration still runs its real extractor and gates. */
export async function seedStudyQualifiedEpisode(
  prisma: PrismaClient,
  input: {
    assignment: { id: string; arm: "CONTROL" | "CHALLENGER"; profileId: string }
    runtime: string
    protocol: { controlManifestId: unknown; challengerManifestId: unknown }
    startsAt: Date
    expiresAt: Date
  },
) {
  const { assignment, runtime, protocol, startsAt, expiresAt } = input
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex")
  const assignedAt = new Date(startsAt.getTime() + 3_600_000),
    itemId = randomUUID(),
    eventId = randomUUID(),
    hash = digest(itemId)
  const manifestId =
    assignment.arm === "CONTROL"
      ? String(protocol.controlManifestId)
      : String(protocol.challengerManifestId)
  const request = await prisma.recommendationRequest.create({
    data: {
      contractVersion: "semantic-recommendation-v1",
      surfaceVersion: "watch-below-player-v1",
      manifestId,
      strategyVersion: "semantic-transcript-pgvector-v1",
      classifierVersion: "legacy-position-v0",
      sessionDigest: hash,
      seedMediaId: "seed",
      locale: "en",
      expectedItemCount: 1,
      state: "ISSUED",
      result: "SERVED",
      deliveryJti: randomUUID(),
      signingKid: "test",
      createdAt: assignedAt,
      issuedAt: assignedAt,
      expiresAt,
      experimentAssignmentId: assignment.id,
      items: {
        create: {
          id: itemId,
          position: 0,
          targetMediaId: "target",
          canonicalHref: "/watch/target.html",
          candidateGenerator: "semantic",
          candidateProvenance: {},
          expiresAt,
        },
      },
    },
  })
  await prisma.recommendationPersonalizationDecision.create({
    data: {
      requestId: request.id,
      lane: runtime === "incumbent" ? "profile_challenger" : "semantic_control",
      executionMode:
        runtime === "incumbent"
          ? "viewing_mode_personalized"
          : "semantic_contextual",
      effectiveManifestId: manifestId,
      ...(runtime === "incumbent"
        ? {
            reasonCode: "viewing_mode_preference",
            projectionScope: "durable",
            projectionVersion: "multi-interest-profile-projection-v1",
            projectionGenerationNumber: 1,
            interestCount: 1,
          }
        : {}),
      expiresAt,
    },
  })
  await prisma.recommendationCandidateRun.create({
    data: {
      requestId: request.id,
      purpose: "watch",
      contextVersion: "recommendation-context-v1",
      generatorVersion:
        runtime === "incumbent"
          ? "semantic-profile-hybrid-generators-v1"
          : "semantic-transcript-candidate-v1",
      unionVersion: "canonical-video-union-v1",
      eligibilityVersion: "watch-playable-locale-v1",
      rankerVersion:
        runtime === "incumbent"
          ? "viewing-mode-affinity-v1"
          : "semantic-deterministic-ranker-v1",
      composerVersion:
        runtime === "incumbent"
          ? "recent-video-refill-composer-v1"
          : "minimal-playable-slate-v1",
      candidateEligibilityParity: "passed",
      rankerParity: "passed",
      nominatedCount: 1,
      canonicalizedCount: 1,
      deduplicatedCount: 1,
      rejectedCount: 0,
      scoredCount: 1,
      orderedCount: 1,
      composedCount: 1,
      evidenceComplete: true,
      expiresAt,
    },
  })
  await prisma.recommendationImpression.create({
    data: {
      requestId: request.id,
      itemId,
      capabilityJti: eventId,
      eventId,
      payloadDigest: hash,
      visibilityPolicy: "watch-below-player-v1",
      occurredAt: assignedAt,
      receivedAt: assignedAt,
      expiresAt,
    },
  })
  await prisma.recommendationExperimentExposure.create({
    data: {
      assignmentId: assignment.id,
      requestId: request.id,
      itemId,
      eventId,
      arm: assignment.arm,
      effectiveManifestId: manifestId,
      assignmentProbability: 0.5,
      payloadDigest: hash,
      occurredAt: assignedAt,
      receivedAt: assignedAt,
      expiresAt,
    },
  })
  const selection = await prisma.recommendationSelection.create({
    data: {
      requestId: request.id,
      itemId,
      capabilityJti: randomUUID(),
      eventId: randomUUID(),
      payloadDigest: hash,
      claimNonceDigest: hash,
      handoffExpiresAt: expiresAt,
      occurredAt: assignedAt,
      receivedAt: assignedAt,
      attributionEligibleAt: assignedAt,
      expiresAt,
    },
  })
  const episode = await prisma.recommendationPlaybackEpisode.create({
    data: {
      requestId: request.id,
      itemId,
      selectionId: selection.id,
      mediaId: "target",
      sessionDigest: hash,
      state: "FINALIZED",
      claimedAt: assignedAt,
      createdAt: assignedAt,
      activeUntil: new Date(assignedAt.getTime() + 3_600_000),
      hardUntil: new Date(assignedAt.getTime() + 6 * 3_600_000),
      expiresAt,
    },
  })
  const outcome = await prisma.recommendationOutcomeRevision.create({
    data: {
      requestId: request.id,
      itemId,
      episodeId: episode.id,
      classifierVersion: "active-watch-proxy-v1",
      revision: 1,
      factWatermark: 1,
      inputDigest: hash,
      qualifiedView: true,
      viewQualityWeight: 1,
      viewQualityWeightReason: "active_fraction_of_duration",
      activePlaybackMilliseconds: 30_000,
      durationSeconds: 30,
      durationCohort: "short",
      activeCoverage: "complete",
      generation: 1,
      expiresAt,
    },
  })
  await prisma.recommendationEligibilityDecision.create({
    data: {
      sourceType: "PLAYBACK_OUTCOME",
      sourceKey: `playback_outcome:${outcome.id}`,
      outcomeId: outcome.id,
      policyVersion: "recommendation-integrity-v1",
      revision: 1,
      actorClass: "HUMAN_ANONYMOUS",
      state: "ELIGIBLE",
      eligibleScopes: ["experiment"],
      contributionWeight: 1,
      contributionOrdinal: 1,
      distinctSupport: 1,
      identityConcentration: 1,
      inputDigest: hash,
      expiresAt,
    },
  })
}
