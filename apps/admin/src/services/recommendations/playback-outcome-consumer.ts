import type { PrismaClient } from "@prisma/client"
import { prisma as defaultPrisma } from "@/db/client"
import {
  ACTIVE_WATCH_PROXY_VERSION,
  PLAYBACK_OUTCOME_CONTRACT_VERSION,
  type PlaybackDiscoverySource,
} from "./contracts"
import { createRecommendationIntegrityService } from "./integrity.service"
import { resolveActiveRecommendationProfileLink } from "./profiles/active-profile-link"
import { dispatchRecommendationProfileFeedback } from "./profiles/job"

export type PlaybackOutcomeEnvelope = Readonly<{
  contractVersion: typeof PLAYBACK_OUTCOME_CONTRACT_VERSION
  outcomeId: string
  episodeId: string
  revision: number
  factWatermark: number
  inputDigest: string
  discoverySource: PlaybackDiscoverySource
  provenance: Record<string, string>
  mediaId: string
  sessionDigest: string
  qualifiedView: boolean
  activePlaybackMilliseconds: number
  durationSeconds: number | null
  durationCohort: string
  activeCoverage: string
  createdAt: Date
}>

/**
 * Stable, source-neutral handoff. Playback owns immutable measurement through
 * this DTO; recommendation consumers own consent, integrity, and preference
 * eligibility after accepting the envelope.
 */
export async function readPlaybackOutcomeEnvelope(
  outcomeId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<PlaybackOutcomeEnvelope | null> {
  const outcome = await prisma.recommendationOutcomeRevision.findUnique({
    where: { id: outcomeId },
    include: { episode: true },
  })
  if (
    !outcome ||
    outcome.classifierVersion !== ACTIVE_WATCH_PROXY_VERSION ||
    outcome.activePlaybackMilliseconds == null ||
    outcome.durationCohort == null ||
    outcome.activeCoverage == null
  ) {
    return null
  }
  const provenance =
    outcome.episode.provenance != null &&
    typeof outcome.episode.provenance === "object" &&
    !Array.isArray(outcome.episode.provenance)
      ? (outcome.episode.provenance as Record<string, string>)
      : {}
  return {
    contractVersion: PLAYBACK_OUTCOME_CONTRACT_VERSION,
    outcomeId: outcome.id,
    episodeId: outcome.episodeId,
    revision: outcome.revision,
    factWatermark: outcome.factWatermark,
    inputDigest: outcome.inputDigest,
    discoverySource: outcome.episode.discoverySource as PlaybackDiscoverySource,
    provenance,
    mediaId: outcome.episode.mediaId,
    sessionDigest: outcome.episode.sessionDigest,
    qualifiedView: outcome.qualifiedView,
    activePlaybackMilliseconds: outcome.activePlaybackMilliseconds,
    durationSeconds: outcome.durationSeconds,
    durationCohort: outcome.durationCohort,
    activeCoverage: outcome.activeCoverage,
    createdAt: outcome.createdAt,
  }
}

export async function dispatchPlaybackOutcomeToRecommendationConsumer(
  outcomeId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<void> {
  const envelope = await readPlaybackOutcomeEnvelope(outcomeId, prisma)
  if (!envelope) return
  const receipt = await createRecommendationIntegrityService(
    prisma,
  ).classifyPlaybackOutcome(envelope.outcomeId)
  if (
    receipt.state !== "eligible" ||
    !receipt.eligibleScopes.includes("profile")
  ) {
    return
  }
  const activeProfile = await resolveActiveRecommendationProfileLink(prisma, {
    sessionDigest: envelope.sessionDigest,
    now: new Date(),
  })
  if (!activeProfile) return
  await dispatchRecommendationProfileFeedback({
    sessionDigest: envelope.sessionDigest,
    profileId: activeProfile.profileId,
    privacyGeneration: activeProfile.privacyGeneration,
    evidenceWatermark: envelope.createdAt,
  })
}
