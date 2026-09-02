import { randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationAuditKind,
  RecommendationEpisodeState,
  type PrismaClient,
} from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { prisma as defaultPrisma } from "@/db/client"
import {
  isTerminalRecommendationFactKind,
  MAX_EVIDENCE_REQUEST_BYTES,
  MAX_EPISODE_FACTS,
  RecommendationPlaybackBatchSchema,
  type RecommendationPlaybackEvent,
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
import { withRecommendationSerializableRetry } from "./transaction-retry"
import {
  recommendationEvidenceDigest,
  recordRecommendationContextConflict,
} from "./evidence.service"
import { createRuntimeRecommendationTokenService } from "./runtime-token"
import { consumePlaybackContextCapabilitySubmissions } from "./submission-budget"
import {
  dispatchRecommendationEpisodeFinalization,
  scheduleRecommendationEpisodeFinalization,
  type RecommendationFinalizationWake,
} from "./finalization/job"
import type { EpisodeCapabilityBinding } from "./token.service"

const FACT_LIMITS: Readonly<
  Record<RecommendationPlaybackEvent["kind"], number>
> = {
  playback_attempt: 1,
  playback_start: 1,
  playback_progress: 64,
  playback_seek: 32,
  playback_active_visible_playing: 64,
  playback_end: 1,
  playback_error: 1,
}

type PlaybackTokenService = {
  verifyEpisodeCapability(
    token: string,
    input: EpisodeCapabilityBinding & {
      eventKind: RecommendationPlaybackEvent["kind"]
      occurredAt: Date
      receivedAt: Date
    },
  ): Promise<{ late: boolean }>
}

export type RecommendationPlaybackReceipt = {
  eventId: string
  status: "accepted" | "replay" | "conflict"
  sequence: number
}

type PlaybackDependencies = {
  prisma: PrismaClient
  tokenService: PlaybackTokenService
  dispatchFinalization?: RecommendationFinalizationWake
  now?: () => Date
  newId?: () => string
}

type PlaybackInput = {
  caller: Principal | null
  contractVersion: string
  capability: string
  contextId?: string
  episodeId: string
  sessionDigest: string
  mediaId: string
  events: Array<{
    eventId: string
    kind: string
    occurredAt: string
    payload?: unknown
  }>
}

class PlaybackCommittedRejectionError extends RecommendationInputError {
  constructor(
    readonly reasonCode: string,
    message: string,
  ) {
    super(message)
    this.name = "PlaybackCommittedRejectionError"
  }
}

export class RecommendationPlaybackService {
  constructor(private readonly deps: PlaybackDependencies) {}

  digest(event: RecommendationPlaybackEvent): string {
    return recommendationEvidenceDigest(event)
  }

  async record(input: PlaybackInput): Promise<RecommendationPlaybackReceipt[]> {
    assertWebRecommendationCaller(input.caller)
    const payload = {
      contractVersion: input.contractVersion,
      capability: input.capability,
      contextId: input.contextId,
      episodeId: input.episodeId,
      sessionDigest: input.sessionDigest,
      mediaId: input.mediaId,
      events: input.events,
    }
    if (
      Buffer.byteLength(JSON.stringify(payload)) > MAX_EVIDENCE_REQUEST_BYTES
    ) {
      throw new RecommendationInputError(
        "Recommendation playback request is too large",
      )
    }
    const parsed = RecommendationPlaybackBatchSchema.parse(payload)
    const now = this.deps.now?.() ?? new Date()
    const episode =
      await this.deps.prisma.recommendationPlaybackEpisode.findUnique({
        where: { id: parsed.episodeId },
        include: {
          context: true,
          request: {
            include: {
              experimentAssignment: { include: { profile: true } },
            },
          },
        },
      })
    if (
      !episode ||
      episode.sessionDigest !== parsed.sessionDigest ||
      episode.mediaId !== parsed.mediaId ||
      episode.capabilityJti == null ||
      episode.context.expiresAt <= now ||
      episode.context.generation !== episode.generation ||
      (parsed.contextId != null && parsed.contextId !== episode.contextId) ||
      (episode.request != null &&
        (episode.request.expiresAt <= now ||
          episode.request.generation !== episode.generation ||
          !isRecommendationAssignmentCapabilityCurrent(
            episode.request.experimentAssignment,
            now,
          ))) ||
      episode.state === RecommendationEpisodeState.PENDING
    ) {
      throw new RecommendationBindingError(
        "Recommendation playback binding is invalid",
      )
    }
    if (now > episode.hardUntil) {
      throw new RecommendationBindingError(
        "Recommendation playback hard horizon expired",
      )
    }
    const evidenceControl =
      await this.deps.prisma.recommendationPlaybackEvidenceControl.findUnique({
        where: { id: "recommendation-playback-evidence-control" },
      })
    if (!evidenceControl?.enabled) {
      throw new RecommendationCapabilityUnavailableError()
    }

    const capabilityBinding: EpisodeCapabilityBinding = {
      jti: episode.capabilityJti,
      episodeId: episode.id,
      contextId: episode.contextId,
      requestId: episode.requestId ?? undefined,
      itemId: episode.itemId ?? undefined,
      sessionDigest: episode.sessionDigest,
      mediaId: episode.mediaId,
      generation: episode.generation,
    }
    for (const event of parsed.events) {
      const occurredAt = new Date(event.occurredAt)
      if (event.kind === "playback_active_visible_playing") {
        const startedAt = event.payload.startedAt
          ? new Date(event.payload.startedAt)
          : null
        const endedAt = event.payload.endedAt
          ? new Date(event.payload.endedAt)
          : null
        if (
          (startedAt != null || endedAt != null) &&
          (startedAt == null ||
            endedAt == null ||
            Math.abs(endedAt.getTime() - occurredAt.getTime()) > 1_000 ||
            startedAt < episode.claimedAt! ||
            endedAt > episode.activeUntil)
        ) {
          throw new RecommendationInputError(
            "Recommendation active-playing interval is invalid",
          )
        }
      }
      const isTerminal = isTerminalRecommendationFactKind(event.kind)
      const late = now > episode.activeUntil || occurredAt > episode.activeUntil
      if (occurredAt > episode.activeUntil || (late && !isTerminal)) {
        throw new RecommendationInputError(
          "Recommendation playback late terminal fact is invalid",
        )
      }
      await this.deps.tokenService.verifyEpisodeCapability(parsed.capability, {
        ...capabilityBinding,
        eventKind: event.kind,
        occurredAt,
        receivedAt: now,
      })
    }
    await consumePlaybackContextCapabilitySubmissions(this.deps.prisma, {
      contextId: episode.contextId,
      episodeId: episode.id,
      capabilityJti: episode.capabilityJti,
      attempts: parsed.events.length,
      expiresAt: episode.context.expiresAt,
    })

    const newId = this.deps.newId ?? randomUUID
    let transactionResult: {
      receipts: RecommendationPlaybackReceipt[]
      acceptedFact: boolean
      acceptedTerminal: boolean
      hasTerminal: boolean
    }
    try {
      transactionResult = await withRecommendationSerializableRetry(() =>
        this.deps.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${parsed.episodeId}, 368))
        `
            const locked = await tx.recommendationPlaybackEpisode.findUnique({
              where: { id: parsed.episodeId },
              include: {
                context: true,
                request: {
                  include: {
                    experimentAssignment: { include: { profile: true } },
                  },
                },
              },
            })
            if (
              !locked ||
              locked.generation !== episode.generation ||
              locked.context.generation !== episode.generation ||
              locked.capabilityJti !== episode.capabilityJti ||
              locked.context.expiresAt <= now ||
              (locked.request != null &&
                (locked.request.generation !== episode.generation ||
                  !isRecommendationAssignmentCapabilityCurrent(
                    locked.request.experimentAssignment,
                    now,
                  )))
            ) {
              throw new RecommendationConflictError(
                "Recommendation playback generation conflicted",
              )
            }
            if (
              locked.request != null &&
              !(await lockRecommendationAssignmentCapabilityFence(
                tx,
                locked.request.experimentAssignment,
                now,
              ))
            ) {
              throw new RecommendationBindingError(
                "Recommendation playback binding is invalid",
              )
            }

            const pending: Array<{
              event: RecommendationPlaybackEvent
              digest: string
            }> = []
            const receipts = new Map<string, RecommendationPlaybackReceipt>()
            let hasTerminal = false
            const existingFacts = await tx.recommendationPlaybackFact.findMany({
              where: {
                episodeId: locked.id,
              },
              select: {
                eventId: true,
                kind: true,
                payloadDigest: true,
                sequence: true,
              },
            })
            const existingByEventId = new Map(
              existingFacts.map((fact) => [fact.eventId, fact]),
            )
            const replayAudits: Prisma.RecommendationEvidenceAuditCreateManyInput[] =
              []
            for (const event of parsed.events) {
              const digest = this.digest(event)
              const existing = existingByEventId.get(event.eventId)
              if (!existing) {
                pending.push({ event, digest })
                continue
              }
              if (existing.payloadDigest === digest) {
                replayAudits.push({
                  contextId: locked.contextId,
                  kind: RecommendationAuditKind.REPLAY,
                  reasonCode: "playback_fact_replay",
                  expiresAt: locked.context.expiresAt,
                })
                receipts.set(event.eventId, {
                  eventId: event.eventId,
                  status: "replay",
                  sequence: existing.sequence,
                })
              } else {
                await recordRecommendationContextConflict(tx, {
                  contextId: locked.contextId,
                  capabilityJti: locked.capabilityJti!,
                  eventId: event.eventId,
                  acceptedDigest: existing.payloadDigest,
                  rejectedDigest: digest,
                  expiresAt: locked.context.expiresAt,
                })
                receipts.set(event.eventId, {
                  eventId: event.eventId,
                  status: "conflict",
                  sequence: existing.sequence,
                })
              }
            }
            if (replayAudits.length > 0) {
              await tx.recommendationEvidenceAudit.createMany({
                data: replayAudits,
              })
            }

            if (pending.length > 0) {
              const existingCount = existingFacts.length
              if (existingCount + pending.length > MAX_EPISODE_FACTS) {
                throw new PlaybackCommittedRejectionError(
                  "playback_fact_budget_exceeded",
                  "Recommendation playback fact budget exceeded",
                )
              }
              const counts = new Map<string, number>()
              for (const fact of existingFacts) {
                counts.set(fact.kind, (counts.get(fact.kind) ?? 0) + 1)
              }
              for (const { event } of pending) {
                counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1)
                if ((counts.get(event.kind) ?? 0) > FACT_LIMITS[event.kind]) {
                  throw new PlaybackCommittedRejectionError(
                    "playback_fact_cardinality_exceeded",
                    "Recommendation playback fact cardinality exceeded",
                  )
                }
              }
              const terminalCount =
                (counts.get("playback_end") ?? 0) +
                (counts.get("playback_error") ?? 0)
              if (terminalCount > 1) {
                throw new PlaybackCommittedRejectionError(
                  "playback_terminal_cardinality_exceeded",
                  "Recommendation playback terminal cardinality exceeded",
                )
              }
              hasTerminal = terminalCount === 1

              const nextFactSequence = locked.nextFactSequence + pending.length
              const reserved =
                await tx.recommendationPlaybackEpisode.updateMany({
                  where: {
                    id: locked.id,
                    generation: locked.generation,
                    nextFactSequence: locked.nextFactSequence,
                  },
                  data: {
                    nextFactSequence,
                    ...(hasTerminal ? { finalizationDueAt: now } : {}),
                  },
                })
              if (reserved.count !== 1) {
                throw new RecommendationConflictError(
                  "Recommendation playback sequence conflicted",
                )
              }
              const factRows: Prisma.RecommendationPlaybackFactCreateManyInput[] =
                []
              const evidenceAudits: Prisma.RecommendationEvidenceAuditCreateManyInput[] =
                []
              for (const [index, { event, digest }] of pending.entries()) {
                const sequence = locked.nextFactSequence + index
                const late = now > locked.activeUntil
                factRows.push({
                  id: newId(),
                  requestId: locked.requestId,
                  itemId: locked.itemId,
                  episodeId: locked.id,
                  capabilityJti: locked.capabilityJti!,
                  eventId: event.eventId,
                  payloadDigest: digest,
                  sequence,
                  kind: event.kind,
                  payload: event.payload as Prisma.InputJsonValue,
                  occurredAt: new Date(event.occurredAt),
                  receivedAt: now,
                  late,
                  expiresAt: locked.context.expiresAt,
                })
                evidenceAudits.push({
                  contextId: locked.contextId,
                  kind: late
                    ? RecommendationAuditKind.LATE
                    : RecommendationAuditKind.EVIDENCE_SUCCESS,
                  reasonCode: event.kind,
                  expiresAt: locked.context.expiresAt,
                })
                receipts.set(event.eventId, {
                  eventId: event.eventId,
                  status: "accepted",
                  sequence,
                })
              }
              await tx.recommendationPlaybackFact.createMany({
                data: factRows,
              })
              await tx.recommendationEvidenceAudit.createMany({
                data: evidenceAudits,
              })
            }
            return {
              receipts: parsed.events.map(
                (event) => receipts.get(event.eventId)!,
              ),
              acceptedFact: pending.length > 0,
              acceptedTerminal: pending.some(({ event }) =>
                isTerminalRecommendationFactKind(event.kind),
              ),
              hasTerminal,
            }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      )
    } catch (error) {
      if (error instanceof PlaybackCommittedRejectionError) {
        await this.deps.prisma.recommendationEvidenceAudit.create({
          data: {
            contextId: episode.contextId,
            kind: RecommendationAuditKind.COMMITTED_REJECTION,
            reasonCode: error.reasonCode,
            detail: { episodeId: episode.id, generation: episode.generation },
            expiresAt: episode.context.expiresAt,
          },
        })
      }
      throw error
    }

    if (transactionResult.acceptedFact && transactionResult.hasTerminal) {
      scheduleRecommendationEpisodeFinalization(
        this.deps.dispatchFinalization,
        {
          episodeId: episode.id,
          generation: episode.generation,
          reason: transactionResult.acceptedTerminal
            ? "terminal-fact"
            : "fact-advanced",
          notBefore: now,
        },
      )
    }
    return transactionResult.receipts
  }
}

export function createRecommendationPlaybackService(
  prisma: PrismaClient = defaultPrisma,
  dispatchFinalization: RecommendationFinalizationWake = dispatchRecommendationEpisodeFinalization,
) {
  const tokenService = createRuntimeRecommendationTokenService(prisma)
  if (!tokenService) throw new RecommendationCapabilityUnavailableError()
  return new RecommendationPlaybackService({
    prisma,
    tokenService,
    dispatchFinalization,
  })
}
