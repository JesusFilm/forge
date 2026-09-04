import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
  RecommendationAuditKind,
  RecommendationEpisodeState,
  RecommendationExperimentArm,
  RecommendationRequestState,
  type PrismaClient,
} from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { prisma as defaultPrisma } from "@/db/client"
import {
  PLAYBACK_CONTEXT_VERSION,
  PlaybackContextIssueSchema,
  RECOMMENDATION_CONTRACTS,
  RECOMMENDATION_RAW_RETENTION_DAYS,
  type PlaybackContextDiscoverySource,
} from "./contracts"
import { assertWebRecommendationCaller } from "./caller"
import {
  isRecommendationAssignmentCapabilityCurrent,
  lockRecommendationAssignmentCapabilityFence,
} from "./assignment-capability"
import {
  RecommendationBindingError,
  RecommendationCapabilityUnavailableError,
  RecommendationConflictError,
  RecommendationInputError,
} from "./errors"
import {
  lockRecommendationItemEvidence,
  recommendationEvidenceDigest,
  recordRecommendationConflict,
} from "./evidence.service"
import { createRuntimeRecommendationTokenService } from "./runtime-token"
import { consumeDeliveryCapabilitySubmissions } from "./submission-budget"
import {
  dispatchRecommendationEpisodeFinalization,
  scheduleRecommendationEpisodeFinalization,
  type RecommendationFinalizationWake,
} from "./finalization/job"
import { resolveActiveRecommendationProfileLink } from "./profiles/active-profile-link"
import type {
  DeliveryCapabilityBinding,
  EpisodeCapabilityBinding,
} from "./token.service"
import {
  EPISODE_CAPABILITY_ACTIVE_SECONDS,
  EPISODE_CAPABILITY_HARD_SECONDS,
  RECOMMENDATION_TOKEN_CLOCK_SKEW_SECONDS,
} from "./token.service"

const HANDOFF_LIFETIME_MS = 10 * 60 * 1_000
const EPISODE_ACTIVE_MS = EPISODE_CAPABILITY_ACTIVE_SECONDS * 1_000
const EPISODE_HARD_MS = EPISODE_CAPABILITY_HARD_SECONDS * 1_000
const EPISODE_RETENTION_MS =
  RECOMMENDATION_RAW_RETENTION_DAYS * 24 * 60 * 60 * 1_000

type EpisodeTokenService = {
  activeKid: string
  verifyDeliveryCapability(
    token: string,
    expected: DeliveryCapabilityBinding,
  ): Promise<{ iat: number; exp: number }>
  signEpisodeCapability(
    binding: EpisodeCapabilityBinding,
    replay?: { issuedAt: Date; signingKid: string },
  ): Promise<string>
}

type EpisodeDependencies = {
  prisma: PrismaClient
  tokenService: EpisodeTokenService
  now?: () => Date
  newId?: () => string
  newClaimNonce?: () => string
  dispatchFinalization?: RecommendationFinalizationWake
  dispatchProfileFeedback?: (input: {
    sessionDigest: string
    profileId: string
    privacyGeneration: number
    evidenceWatermark: Date
  }) => Promise<unknown>
}

export class RecommendationEpisodeService {
  constructor(private readonly deps: EpisodeDependencies) {}

  async issueContext(input: {
    caller: Principal | null
    sessionDigest: string
    mediaId: string
    discoverySource: PlaybackContextDiscoverySource
    provenance?: Record<string, string>
  }) {
    assertWebRecommendationCaller(input.caller)
    const parsed = PlaybackContextIssueSchema.parse({
      sessionDigest: input.sessionDigest,
      mediaId: input.mediaId,
      discoverySource: input.discoverySource,
      provenance: input.provenance ?? {},
    })
    const now = this.deps.now?.() ?? new Date()
    const newId = this.deps.newId ?? randomUUID
    const claimNonce =
      this.deps.newClaimNonce?.() ?? randomBytes(32).toString("base64url")
    const claimNonceDigest = createHash("sha256")
      .update(claimNonce)
      .digest("hex")
    const activeUntil = new Date(now.getTime() + EPISODE_ACTIVE_MS)
    const hardUntil = new Date(now.getTime() + EPISODE_HARD_MS)

    await this.deps.prisma.recommendationPlaybackEpisode.create({
      data: {
        id: newId(),
        requestId: null,
        itemId: null,
        selectionId: null,
        contextVersion: PLAYBACK_CONTEXT_VERSION,
        discoverySource: parsed.discoverySource,
        provenance: parsed.provenance,
        claimNonceDigest,
        handoffExpiresAt: new Date(now.getTime() + HANDOFF_LIFETIME_MS),
        mediaId: parsed.mediaId,
        sessionDigest: parsed.sessionDigest,
        state: RecommendationEpisodeState.PENDING,
        activeUntil,
        hardUntil,
        finalizationDueAt: null,
        expiresAt: new Date(now.getTime() + EPISODE_RETENTION_MS),
      },
    })

    return { claimNonce, contextVersion: PLAYBACK_CONTEXT_VERSION }
  }

  async select(input: {
    caller: Principal | null
    contractVersion: string
    capability: string
    requestId: string
    itemId: string
    sessionDigest: string
    eventId: string
    occurredAt: string
    tabDigest?: string | null
    claimNonce: string
  }) {
    assertWebRecommendationCaller(input.caller)
    if (input.contractVersion !== RECOMMENDATION_CONTRACTS.evidence) {
      throw new RecommendationInputError(
        "Recommendation evidence contract is invalid",
      )
    }
    if (!/^[a-f0-9]{64}$/.test(input.sessionDigest)) {
      throw new RecommendationBindingError(
        "Recommendation selection binding is invalid",
      )
    }
    if (
      input.capability.length < 1 ||
      input.capability.length > 4096 ||
      input.requestId.length < 1 ||
      input.requestId.length > 191 ||
      input.itemId.length < 1 ||
      input.itemId.length > 191 ||
      input.eventId.length < 1 ||
      input.eventId.length > 191 ||
      input.claimNonce.length < 16 ||
      input.claimNonce.length > 191
    ) {
      throw new RecommendationBindingError(
        "Recommendation selection binding is invalid",
      )
    }
    if (input.tabDigest != null && !/^[a-f0-9]{64}$/.test(input.tabDigest)) {
      throw new RecommendationInputError("Recommendation tab digest is invalid")
    }
    const now = this.deps.now?.() ?? new Date()
    const item = await this.deps.prisma.recommendationServedItem.findUnique({
      where: { id: input.itemId },
      include: {
        request: {
          include: {
            experimentAssignment: {
              include: { experiment: true, profile: true },
            },
          },
        },
      },
    })
    if (
      !item ||
      item.requestId !== input.requestId ||
      item.capabilityJti == null ||
      item.request.state !== RecommendationRequestState.ISSUED ||
      item.request.expiresAt <= now ||
      item.request.sessionDigest !== input.sessionDigest ||
      !isRecommendationAssignmentCapabilityCurrent(
        item.request.experimentAssignment,
        now,
      )
    ) {
      throw new RecommendationBindingError(
        "Recommendation selection binding is invalid",
      )
    }
    const capabilityJti = item.capabilityJti
    const assignment = item.request.experimentAssignment
    const verified = await this.deps.tokenService.verifyDeliveryCapability(
      input.capability,
      {
        jti: capabilityJti,
        requestId: item.requestId,
        itemId: item.id,
        sessionDigest: item.request.sessionDigest,
        surface: RECOMMENDATION_CONTRACTS.surface,
        manifestId: item.request.manifestId,
        ...(assignment
          ? {
              assignmentId: assignment.id,
              experimentId: assignment.experimentId,
              experimentVersion: assignment.experiment.experimentVersion,
              experimentGeneration: assignment.experiment.generation,
              experimentArm:
                assignment.arm === RecommendationExperimentArm.CHALLENGER
                  ? ("challenger" as const)
                  : ("control" as const),
              effectiveManifestId:
                assignment.arm === RecommendationExperimentArm.CHALLENGER
                  ? assignment.experiment.challengerManifestId
                  : assignment.experiment.controlManifestId,
              assignmentProbability: assignment.assignmentProbability,
              assignmentConfigurationDigest: assignment.configurationDigest,
            }
          : {}),
      },
    )
    await consumeDeliveryCapabilitySubmissions(this.deps.prisma, {
      requestId: item.requestId,
      capabilityJti,
      attempts: 1,
      expiresAt: item.request.expiresAt,
    })
    const occurredAt = new Date(input.occurredAt)
    const occurredSeconds = Math.floor(occurredAt.getTime() / 1_000)
    if (
      !Number.isFinite(occurredAt.getTime()) ||
      occurredSeconds <
        verified.iat - RECOMMENDATION_TOKEN_CLOCK_SKEW_SECONDS ||
      occurredSeconds > verified.exp
    ) {
      await this.deps.prisma.recommendationEvidenceAudit.create({
        data: {
          requestId: item.requestId,
          kind: RecommendationAuditKind.COMMITTED_REJECTION,
          reasonCode: "selection_timestamp_invalid",
          expiresAt: item.request.expiresAt,
        },
      })
      throw new RecommendationInputError(
        "Recommendation selection timestamp is invalid",
      )
    }
    const digest = recommendationEvidenceDigest({
      eventId: input.eventId,
      kind: "selection",
      occurredAt: input.occurredAt,
      tabDigest: input.tabDigest ?? null,
      claimNonceDigest: createHash("sha256")
        .update(input.claimNonce)
        .digest("hex"),
    })
    const newId = this.deps.newId ?? randomUUID
    const claimNonceDigest = createHash("sha256")
      .update(input.claimNonce)
      .digest("hex")
    const episodeId = newId()
    const initialActiveUntil = new Date(now.getTime() + EPISODE_ACTIVE_MS)
    const initialHardUntil = new Date(now.getTime() + EPISODE_HARD_MS)

    const result = await this.deps.prisma.$transaction(async (tx) => {
      if (
        !(await lockRecommendationAssignmentCapabilityFence(
          tx,
          assignment,
          now,
        ))
      ) {
        throw new RecommendationBindingError(
          "Recommendation selection binding is invalid",
        )
      }
      await lockRecommendationItemEvidence(tx, item.id)
      const impression = await tx.recommendationImpression.findUnique({
        where: { itemId: item.id },
        select: { receivedAt: true },
      })
      const existing = await tx.recommendationSelection.findUnique({
        where: { itemId: item.id },
      })
      if (existing) {
        if (existing.payloadDigest === digest) {
          const reconciliation =
            existing.attributionEligibleAt == null && impression
              ? await tx.recommendationSelection.updateMany({
                  where: {
                    id: existing.id,
                    attributionEligibleAt: null,
                  },
                  data: { attributionEligibleAt: now },
                })
              : { count: 0 }
          await tx.recommendationEvidenceAudit.create({
            data: {
              requestId: item.requestId,
              kind: RecommendationAuditKind.REPLAY,
              reasonCode: "selection_replay",
              expiresAt: item.request.expiresAt,
            },
          })
          return {
            status: "replay" as const,
            attributionEligible:
              existing.attributionEligibleAt != null ||
              reconciliation.count === 1,
            attributionReconciled: reconciliation.count === 1,
          }
        }
        await recordRecommendationConflict(tx, {
          requestId: item.requestId,
          capabilityJti,
          eventId: input.eventId,
          acceptedDigest: existing.payloadDigest,
          rejectedDigest: digest,
          expiresAt: item.request.expiresAt,
        })
        return {
          status: "conflict" as const,
          attributionEligible: false,
          attributionReconciled: false,
        }
      }
      await tx.recommendationSelection.create({
        data: {
          id: newId(),
          requestId: item.requestId,
          itemId: item.id,
          capabilityJti,
          eventId: input.eventId,
          payloadDigest: digest,
          tabDigest: input.tabDigest ?? null,
          claimNonceDigest,
          attributionEligibleAt: impression ? now : null,
          handoffExpiresAt: new Date(now.getTime() + HANDOFF_LIFETIME_MS),
          occurredAt,
          receivedAt: now,
          expiresAt: item.request.expiresAt,
          episode: {
            create: {
              id: episodeId,
              contextVersion: PLAYBACK_CONTEXT_VERSION,
              discoverySource: "recommendation",
              provenance: {},
              claimNonceDigest,
              handoffExpiresAt: new Date(now.getTime() + HANDOFF_LIFETIME_MS),
              mediaId: item.targetMediaId,
              sessionDigest: item.request.sessionDigest,
              state: RecommendationEpisodeState.PENDING,
              activeUntil: initialActiveUntil,
              hardUntil: initialHardUntil,
              finalizationDueAt: initialActiveUntil,
              expiresAt: item.request.expiresAt,
            },
          },
        },
        include: { episode: true },
      })
      await tx.recommendationEvidenceAudit.create({
        data: {
          requestId: item.requestId,
          kind: RecommendationAuditKind.EVIDENCE_SUCCESS,
          reasonCode: "selection",
          expiresAt: item.request.expiresAt,
        },
      })
      return {
        status: "accepted" as const,
        attributionEligible: impression != null,
        attributionReconciled: false,
      }
    })
    if (result.status === "conflict") {
      return {
        status: result.status,
        claimNonce: null,
        canonicalHref: item.canonicalHref,
        targetMediaId: item.targetMediaId,
      }
    }
    if (result.status === "accepted") {
      scheduleRecommendationEpisodeFinalization(
        this.deps.dispatchFinalization,
        {
          episodeId,
          generation: 1,
          reason: "episode-opened",
          notBefore: initialActiveUntil,
        },
      )
    }
    const activeProfile =
      (result.status === "accepted" && result.attributionEligible) ||
      result.attributionReconciled
        ? await resolveActiveRecommendationProfileLink(this.deps.prisma, {
            sessionDigest: item.request.sessionDigest,
            now,
          })
        : null
    if (activeProfile) {
      void this.deps
        .dispatchProfileFeedback?.({
          sessionDigest: item.request.sessionDigest,
          profileId: activeProfile.profileId,
          privacyGeneration: activeProfile.privacyGeneration,
          // Coalescing must advance from immutable committed server evidence,
          // never a browser-controlled timestamp that can be replayed far into
          // the past or future.
          evidenceWatermark: now,
        })
        .catch(() => {
          // Projection workflow truth records dispatch failures. Selection and
          // navigation never wait for profile learning.
        })
    }
    return {
      status: result.status,
      claimNonce: input.claimNonce,
      canonicalHref: item.canonicalHref,
      targetMediaId: item.targetMediaId,
    }
  }

  async claim(input: {
    caller: Principal | null
    sessionDigest: string
    claimNonce: string
    mediaId: string
  }) {
    assertWebRecommendationCaller(input.caller)
    if (
      !/^[a-f0-9]{64}$/.test(input.sessionDigest) ||
      input.claimNonce.length < 16 ||
      input.claimNonce.length > 191 ||
      !input.mediaId ||
      input.mediaId.length > 191
    ) {
      throw new RecommendationBindingError(
        "Recommendation handoff binding is invalid",
      )
    }
    const now = this.deps.now?.() ?? new Date()
    const claimNonceDigest = createHash("sha256")
      .update(input.claimNonce)
      .digest("hex")
    const selection = await this.deps.prisma.recommendationSelection.findUnique(
      {
        where: { claimNonceDigest },
        include: {
          request: {
            include: {
              experimentAssignment: { include: { profile: true } },
            },
          },
          item: true,
          episode: true,
        },
      },
    )
    if (!selection) {
      const context =
        await this.deps.prisma.recommendationPlaybackEpisode.findUnique({
          where: { claimNonceDigest },
        })
      return this.claimStandaloneContext({
        context,
        sessionDigest: input.sessionDigest,
        mediaId: input.mediaId,
        now,
      })
    }
    if (
      !selection.episode ||
      selection.request.sessionDigest !== input.sessionDigest ||
      selection.item.targetMediaId !== input.mediaId ||
      selection.request.expiresAt <= now ||
      !isRecommendationAssignmentCapabilityCurrent(
        selection.request.experimentAssignment,
        now,
      )
    ) {
      throw new RecommendationBindingError(
        "Recommendation handoff binding is invalid",
      )
    }

    if (selection.claimedAt != null) {
      const episode = selection.episode
      const replayHorizonsMatch =
        episode.claimedAt != null &&
        selection.claimedAt.getTime() === episode.claimedAt.getTime() &&
        episode.activeUntil.getTime() ===
          episode.claimedAt.getTime() + EPISODE_ACTIVE_MS &&
        episode.hardUntil.getTime() ===
          episode.claimedAt.getTime() + EPISODE_HARD_MS
      if (
        episode.state !== RecommendationEpisodeState.CLAIMED ||
        episode.capabilityJti == null ||
        episode.signingKid == null ||
        !replayHorizonsMatch ||
        episode.activeUntil <= now
      ) {
        throw new RecommendationBindingError(
          "Recommendation handoff binding is invalid",
        )
      }
      const capability = await this.deps.tokenService.signEpisodeCapability(
        {
          jti: episode.capabilityJti,
          episodeId: episode.id,
          requestId: selection.request.id,
          itemId: selection.item.id,
          sessionDigest: selection.request.sessionDigest,
          mediaId: selection.item.targetMediaId,
          generation: episode.generation,
        },
        { issuedAt: episode.claimedAt!, signingKid: episode.signingKid },
      )
      return {
        episodeId: episode.id,
        capability,
        activeUntil: episode.activeUntil.toISOString(),
        hardUntil: episode.hardUntil.toISOString(),
      }
    }

    if (
      selection.handoffExpiresAt <= now ||
      selection.episode.state !== RecommendationEpisodeState.PENDING
    ) {
      throw new RecommendationBindingError(
        "Recommendation handoff binding is invalid",
      )
    }
    const capabilityJti = (this.deps.newId ?? randomUUID)()
    const activeUntil = new Date(now.getTime() + EPISODE_ACTIVE_MS)
    const hardUntil = new Date(now.getTime() + EPISODE_HARD_MS)
    const binding: EpisodeCapabilityBinding = {
      jti: capabilityJti,
      episodeId: selection.episode.id,
      requestId: selection.request.id,
      itemId: selection.item.id,
      sessionDigest: selection.request.sessionDigest,
      mediaId: selection.item.targetMediaId,
      generation: selection.episode.generation,
    }
    const capability = await this.deps.tokenService.signEpisodeCapability(
      binding,
      { issuedAt: now, signingKid: this.deps.tokenService.activeKid },
    )

    await this.deps.prisma.$transaction(async (tx) => {
      if (
        !(await lockRecommendationAssignmentCapabilityFence(
          tx,
          selection.request.experimentAssignment,
          now,
        ))
      ) {
        throw new RecommendationBindingError(
          "Recommendation handoff binding is invalid",
        )
      }
      const claimed = await tx.recommendationSelection.updateMany({
        where: {
          id: selection.id,
          claimedAt: null,
          handoffExpiresAt: { gt: now },
        },
        data: { claimedAt: now },
      })
      if (claimed.count !== 1) {
        throw new RecommendationConflictError(
          "Recommendation handoff was already claimed",
        )
      }
      const opened = await tx.recommendationPlaybackEpisode.updateMany({
        where: {
          id: selection.episode!.id,
          state: RecommendationEpisodeState.PENDING,
          generation: selection.episode!.generation,
        },
        data: {
          state: RecommendationEpisodeState.CLAIMED,
          capabilityJti,
          signingKid: this.deps.tokenService.activeKid,
          activeUntil,
          hardUntil,
          finalizationDueAt: activeUntil,
          claimedAt: now,
        },
      })
      if (opened.count !== 1) {
        throw new RecommendationConflictError(
          "Recommendation episode claim conflicted",
        )
      }
    })

    scheduleRecommendationEpisodeFinalization(this.deps.dispatchFinalization, {
      episodeId: selection.episode.id,
      generation: selection.episode.generation,
      reason: "episode-opened",
      notBefore: activeUntil,
    })

    return {
      episodeId: selection.episode.id,
      capability,
      activeUntil: activeUntil.toISOString(),
      hardUntil: hardUntil.toISOString(),
    }
  }

  private async claimStandaloneContext(input: {
    context: {
      id: string
      requestId: string | null
      itemId: string | null
      selectionId: string | null
      mediaId: string
      sessionDigest: string
      state: RecommendationEpisodeState
      capabilityJti: string | null
      signingKid: string | null
      handoffExpiresAt: Date | null
      activeUntil: Date
      hardUntil: Date
      generation: number
      claimedAt: Date | null
      expiresAt: Date
    } | null
    sessionDigest: string
    mediaId: string
    now: Date
  }) {
    const { context, now } = input
    if (
      !context ||
      context.requestId != null ||
      context.itemId != null ||
      context.selectionId != null ||
      context.sessionDigest !== input.sessionDigest ||
      context.mediaId !== input.mediaId ||
      context.expiresAt <= now
    ) {
      throw new RecommendationBindingError(
        "Recommendation handoff binding is invalid",
      )
    }

    if (context.claimedAt != null) {
      const replayHorizonsMatch =
        context.activeUntil.getTime() ===
          context.claimedAt.getTime() + EPISODE_ACTIVE_MS &&
        context.hardUntil.getTime() ===
          context.claimedAt.getTime() + EPISODE_HARD_MS
      if (
        context.state !== RecommendationEpisodeState.CLAIMED ||
        context.capabilityJti == null ||
        context.signingKid == null ||
        !replayHorizonsMatch ||
        context.activeUntil <= now
      ) {
        throw new RecommendationBindingError(
          "Recommendation handoff binding is invalid",
        )
      }
      const capability = await this.deps.tokenService.signEpisodeCapability(
        {
          jti: context.capabilityJti,
          episodeId: context.id,
          sessionDigest: context.sessionDigest,
          mediaId: context.mediaId,
          generation: context.generation,
        },
        { issuedAt: context.claimedAt, signingKid: context.signingKid },
      )
      return {
        episodeId: context.id,
        capability,
        activeUntil: context.activeUntil.toISOString(),
        hardUntil: context.hardUntil.toISOString(),
      }
    }

    if (
      context.handoffExpiresAt == null ||
      context.handoffExpiresAt <= now ||
      context.state !== RecommendationEpisodeState.PENDING
    ) {
      throw new RecommendationBindingError(
        "Recommendation handoff binding is invalid",
      )
    }
    const capabilityJti = (this.deps.newId ?? randomUUID)()
    const activeUntil = new Date(now.getTime() + EPISODE_ACTIVE_MS)
    const hardUntil = new Date(now.getTime() + EPISODE_HARD_MS)
    const capability = await this.deps.tokenService.signEpisodeCapability(
      {
        jti: capabilityJti,
        episodeId: context.id,
        sessionDigest: context.sessionDigest,
        mediaId: context.mediaId,
        generation: context.generation,
      },
      { issuedAt: now, signingKid: this.deps.tokenService.activeKid },
    )

    await this.deps.prisma.$transaction(async (tx) => {
      const opened = await tx.recommendationPlaybackEpisode.updateMany({
        where: {
          id: context.id,
          state: RecommendationEpisodeState.PENDING,
          generation: context.generation,
          claimedAt: null,
          handoffExpiresAt: { gt: now },
        },
        data: {
          state: RecommendationEpisodeState.CLAIMED,
          capabilityJti,
          signingKid: this.deps.tokenService.activeKid,
          activeUntil,
          hardUntil,
          finalizationDueAt: activeUntil,
          claimedAt: now,
        },
      })
      if (opened.count !== 1) {
        throw new RecommendationConflictError(
          "Recommendation episode claim conflicted",
        )
      }
    })

    scheduleRecommendationEpisodeFinalization(this.deps.dispatchFinalization, {
      episodeId: context.id,
      generation: context.generation,
      reason: "episode-opened",
      notBefore: activeUntil,
    })
    return {
      episodeId: context.id,
      capability,
      activeUntil: activeUntil.toISOString(),
      hardUntil: hardUntil.toISOString(),
    }
  }
}

export function createRecommendationEpisodeService(
  prisma: PrismaClient = defaultPrisma,
) {
  const tokenService = createRuntimeRecommendationTokenService(prisma)
  if (!tokenService) throw new RecommendationCapabilityUnavailableError()
  return new RecommendationEpisodeService({
    prisma,
    tokenService,
    dispatchFinalization: dispatchRecommendationEpisodeFinalization,
    dispatchProfileFeedback: async (input) => {
      const { dispatchRecommendationProfileFeedback } =
        await import("./profiles/job")
      return dispatchRecommendationProfileFeedback(input)
    },
  })
}
