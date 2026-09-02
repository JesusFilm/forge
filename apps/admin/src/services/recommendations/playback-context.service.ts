import { createHash, randomUUID } from "node:crypto"
import {
  RecommendationAuditKind,
  RecommendationEpisodeState,
  RecommendationPlaybackSource as PrismaPlaybackSource,
  type PrismaClient,
} from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { prisma as defaultPrisma } from "@/db/client"
import { assertWebRecommendationCaller } from "./caller"
import {
  RECOMMENDATION_CONTRACTS,
  RECOMMENDATION_RAW_RETENTION_DAYS,
  RecommendationPlaybackContextInputSchema,
  type RecommendationPlaybackSource,
} from "./contracts"
import {
  RecommendationBindingError,
  RecommendationCapabilityUnavailableError,
  RecommendationConflictError,
} from "./errors"
import {
  dispatchRecommendationEpisodeFinalization,
  scheduleRecommendationEpisodeFinalization,
  type RecommendationFinalizationWake,
} from "./finalization/job"
import { createRuntimeRecommendationTokenService } from "./runtime-token"
import type { EpisodeCapabilityBinding } from "./token.service"
import {
  EPISODE_CAPABILITY_ACTIVE_SECONDS,
  EPISODE_CAPABILITY_HARD_SECONDS,
} from "./token.service"
import {
  createRecommendationEpisodeService,
  type RecommendationEpisodeClaim,
} from "./episode.service"

const ACTIVE_MS = EPISODE_CAPABILITY_ACTIVE_SECONDS * 1_000
const HARD_MS = EPISODE_CAPABILITY_HARD_SECONDS * 1_000
const RAW_RETENTION_MS =
  RECOMMENDATION_RAW_RETENTION_DAYS * 24 * 60 * 60 * 1_000

type ContextTokenService = {
  activeKid: string
  signEpisodeCapability(
    binding: EpisodeCapabilityBinding,
    replay?: { issuedAt: Date; signingKid: string },
  ): Promise<string>
}

type ContextDependencies = {
  prisma: PrismaClient
  tokenService: ContextTokenService
  claimRecommendation: (
    input: Parameters<
      ReturnType<typeof createRecommendationEpisodeService>["claim"]
    >[0],
  ) => Promise<RecommendationEpisodeClaim>
  dispatchFinalization?: RecommendationFinalizationWake
  now?: () => Date
  newId?: () => string
}

export type RecommendationPlaybackContextClaim = RecommendationEpisodeClaim & {
  contextId: string
  source: RecommendationPlaybackSource
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function prismaSource(source: RecommendationPlaybackSource) {
  return PrismaPlaybackSource[
    source.toUpperCase() as keyof typeof PrismaPlaybackSource
  ]
}

export class RecommendationPlaybackContextService {
  constructor(private readonly deps: ContextDependencies) {}

  async open(input: {
    caller: Principal | null
    contractVersion: string
    sessionDigest: string
    mediaId: string
    idempotencyKey: string
    source: string
    sourceRef?: string | null
    claimNonce?: string | null
  }): Promise<RecommendationPlaybackContextClaim> {
    assertWebRecommendationCaller(input.caller)
    const parsed = RecommendationPlaybackContextInputSchema.parse({
      contractVersion: input.contractVersion,
      sessionDigest: input.sessionDigest,
      mediaId: input.mediaId,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      sourceRef: input.sourceRef ?? undefined,
      claimNonce: input.claimNonce ?? undefined,
    })
    const control =
      await this.deps.prisma.recommendationPlaybackEvidenceControl.findUnique({
        where: { id: "recommendation-playback-evidence-control" },
      })
    if (!control?.enabled) {
      throw new RecommendationCapabilityUnavailableError()
    }

    if (parsed.source === "recommendation") {
      const claim = await this.deps.claimRecommendation({
        caller: input.caller,
        sessionDigest: parsed.sessionDigest,
        claimNonce: parsed.claimNonce!,
        mediaId: parsed.mediaId,
        playbackEvidenceControlVersion: control.version,
      })
      return { ...claim, source: "recommendation" }
    }

    const now = this.deps.now?.() ?? new Date()
    const idempotencyKeyDigest = digest(parsed.idempotencyKey)
    const sourceRefDigest = parsed.sourceRef ? digest(parsed.sourceRef) : null
    const existing =
      await this.deps.prisma.recommendationPlaybackContext.findUnique({
        where: {
          sessionDigest_mediaId_idempotencyKeyDigest: {
            sessionDigest: parsed.sessionDigest,
            mediaId: parsed.mediaId,
            idempotencyKeyDigest,
          },
        },
        include: { episode: true },
      })
    if (existing) {
      if (
        existing.source !== prismaSource(parsed.source) ||
        existing.sourceRefDigest !== sourceRefDigest ||
        !existing.episode ||
        existing.episode.state !== RecommendationEpisodeState.CLAIMED ||
        existing.episode.capabilityJti == null ||
        existing.episode.signingKid == null ||
        existing.episode.claimedAt == null ||
        existing.episode.activeUntil <= now
      ) {
        throw new RecommendationConflictError(
          "Recommendation playback context idempotency conflicted",
        )
      }
      const capability = await this.deps.tokenService.signEpisodeCapability(
        {
          jti: existing.episode.capabilityJti,
          episodeId: existing.episode.id,
          contextId: existing.id,
          sessionDigest: existing.sessionDigest,
          mediaId: existing.mediaId,
          generation: existing.generation,
        },
        {
          issuedAt: existing.episode.claimedAt,
          signingKid: existing.episode.signingKid,
        },
      )
      return {
        contextId: existing.id,
        episodeId: existing.episode.id,
        capability,
        activeUntil: existing.episode.activeUntil.toISOString(),
        hardUntil: existing.episode.hardUntil.toISOString(),
        source: parsed.source,
      }
    }

    const newId = this.deps.newId ?? randomUUID
    const contextId = newId()
    const episodeId = newId()
    const capabilityJti = newId()
    const activeUntil = new Date(now.getTime() + ACTIVE_MS)
    const hardUntil = new Date(now.getTime() + HARD_MS)
    const expiresAt = new Date(now.getTime() + RAW_RETENTION_MS)
    const binding: EpisodeCapabilityBinding = {
      jti: capabilityJti,
      episodeId,
      contextId,
      sessionDigest: parsed.sessionDigest,
      mediaId: parsed.mediaId,
      generation: 1,
    }
    const capability = await this.deps.tokenService.signEpisodeCapability(
      binding,
      { issuedAt: now, signingKid: this.deps.tokenService.activeKid },
    )

    try {
      await this.deps.prisma.$transaction(async (tx) => {
        const currentControl =
          await tx.recommendationPlaybackEvidenceControl.findUnique({
            where: { id: "recommendation-playback-evidence-control" },
          })
        if (
          !currentControl?.enabled ||
          currentControl.version !== control.version
        ) {
          throw new RecommendationCapabilityUnavailableError()
        }
        await tx.recommendationPlaybackContext.create({
          data: {
            id: contextId,
            contractVersion: RECOMMENDATION_CONTRACTS.playbackContext,
            idempotencyKeyDigest,
            sessionDigest: parsed.sessionDigest,
            mediaId: parsed.mediaId,
            source: prismaSource(parsed.source),
            sourceRefDigest,
            createdAt: now,
            expiresAt,
            episode: {
              create: {
                id: episodeId,
                mediaId: parsed.mediaId,
                sessionDigest: parsed.sessionDigest,
                state: RecommendationEpisodeState.CLAIMED,
                capabilityJti,
                signingKid: this.deps.tokenService.activeKid,
                activeUntil,
                hardUntil,
                finalizationDueAt: activeUntil,
                claimedAt: now,
                expiresAt,
              },
            },
          },
        })
        await tx.recommendationEvidenceAudit.create({
          data: {
            id: `context-opened:${contextId}`,
            contextId,
            kind: RecommendationAuditKind.EVIDENCE_SUCCESS,
            reasonCode: "playback_context_opened",
            detail: {
              source: parsed.source,
              provenanceAuthoritative: false,
            },
            expiresAt,
          },
        })
      })
    } catch (error) {
      // A concurrent retry may have won the idempotency key. Re-enter once so
      // callers get its deterministic capability instead of a database error.
      const replay =
        await this.deps.prisma.recommendationPlaybackContext.findUnique({
          where: {
            sessionDigest_mediaId_idempotencyKeyDigest: {
              sessionDigest: parsed.sessionDigest,
              mediaId: parsed.mediaId,
              idempotencyKeyDigest,
            },
          },
          include: { episode: true },
        })
      if (!replay) throw error
      if (
        replay.source !== prismaSource(parsed.source) ||
        replay.sourceRefDigest !== sourceRefDigest
      ) {
        throw new RecommendationBindingError(
          "Recommendation playback context binding is invalid",
        )
      }
      return this.open(input)
    }

    scheduleRecommendationEpisodeFinalization(this.deps.dispatchFinalization, {
      episodeId,
      generation: 1,
      reason: "episode-opened",
      notBefore: activeUntil,
    })
    return {
      contextId,
      episodeId,
      capability,
      activeUntil: activeUntil.toISOString(),
      hardUntil: hardUntil.toISOString(),
      source: parsed.source,
    }
  }
}

export function createRecommendationPlaybackContextService(
  prisma: PrismaClient = defaultPrisma,
) {
  const tokenService = createRuntimeRecommendationTokenService(prisma)
  if (!tokenService) throw new RecommendationCapabilityUnavailableError()
  const episodeService = createRecommendationEpisodeService(prisma)
  return new RecommendationPlaybackContextService({
    prisma,
    tokenService,
    claimRecommendation: (input) => episodeService.claim(input),
    dispatchFinalization: dispatchRecommendationEpisodeFinalization,
  })
}
