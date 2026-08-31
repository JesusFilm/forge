import { randomUUID } from "node:crypto"
import {
  RecommendationContentActionActorClass,
  RecommendationContentActionClass,
  RecommendationContentActionKind,
  RecommendationEpisodeState,
  RecommendationRequestPurpose,
  type PrismaClient,
} from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { prisma as defaultPrisma } from "@/db/client"
import {
  RECOMMENDATION_RAW_RETENTION_DAYS,
  RecommendationContentActionSchema,
  type RecommendationContentActionInput,
} from "./contracts"
import { assertWebRecommendationCaller } from "./caller"
import {
  RecommendationAuthenticationError,
  RecommendationInputError,
} from "./errors"
import { recommendationEvidenceDigest } from "./evidence.service"

const ACTION_MATCH_WINDOW_MS = 6 * 60 * 60 * 1_000
const ACTION_CLOCK_SKEW_MS = 5 * 60 * 1_000

const ACTION_CLASS = {
  human_action: RecommendationContentActionClass.HUMAN_ACTION,
  machine_disposition: RecommendationContentActionClass.MACHINE_DISPOSITION,
  reported_value: RecommendationContentActionClass.REPORTED_VALUE,
} as const

const ACTION_KIND = {
  share: RecommendationContentActionKind.SHARE,
  save: RecommendationContentActionKind.SAVE,
  course_add: RecommendationContentActionKind.COURSE_ADD,
  continuation: RecommendationContentActionKind.CONTINUATION,
  machine_disposition: RecommendationContentActionKind.MACHINE_DISPOSITION,
  reported_value: RecommendationContentActionKind.REPORTED_VALUE,
} as const

const ACTOR_CLASS = {
  human_anonymous: RecommendationContentActionActorClass.HUMAN_ANONYMOUS,
  human_signed_in: RecommendationContentActionActorClass.HUMAN_SIGNED_IN,
  machine: RecommendationContentActionActorClass.MACHINE,
  internal: RecommendationContentActionActorClass.INTERNAL,
  test: RecommendationContentActionActorClass.TEST,
} as const

const PURPOSE = {
  watch: RecommendationRequestPurpose.WATCH,
  find_to_share: RecommendationRequestPurpose.FIND_TO_SHARE,
  course_build: RecommendationRequestPurpose.COURSE_BUILD,
  experience_generation: RecommendationRequestPurpose.EXPERIENCE_GENERATION,
} as const

const HUMAN_ACTION_KINDS = new Set([
  "share",
  "save",
  "course_add",
  "continuation",
])
const MACHINE_ACTORS = new Set(["machine", "internal", "test"])

type ContentActionDependencies = {
  prisma: PrismaClient
  now?: () => Date
  newId?: () => string
  newAuditId?: () => string
}

type ContentActionInput = {
  caller: Principal | null
  contractVersion: string
  sessionDigest: string
  eventId: string
  occurredAt: string
  mediaId: string
  actionClass: string
  actionKind: string
  actorClass: string
  purpose: string
  actionDetail?: string | null
  destination: {
    artifactType: string
    artifactId: string
  } | null
}

export type RecommendationContentActionReceipt = Readonly<{
  actionId: string
  eventId: string
  status: "accepted" | "replay" | "conflict"
  matched: boolean
  late: boolean
}>

export class RecommendationContentActionService {
  constructor(private readonly deps: ContentActionDependencies) {}

  async record(
    input: ContentActionInput,
  ): Promise<RecommendationContentActionReceipt> {
    const parsed = RecommendationContentActionSchema.parse({
      contractVersion: input.contractVersion,
      sessionDigest: input.sessionDigest,
      eventId: input.eventId,
      occurredAt: input.occurredAt,
      mediaId: input.mediaId,
      actionClass: input.actionClass,
      actionKind: input.actionKind,
      actorClass: input.actorClass,
      purpose: input.purpose,
      actionDetail: input.actionDetail,
      destination: input.destination,
    })
    this.assertCaller(input.caller, parsed.actorClass)
    this.assertClassAndKind(parsed)

    const now = this.deps.now?.() ?? new Date()
    const occurredAt = new Date(parsed.occurredAt)
    if (
      occurredAt.getTime() > now.getTime() + ACTION_CLOCK_SKEW_MS ||
      occurredAt.getTime() < now.getTime() - ACTION_MATCH_WINDOW_MS
    ) {
      throw new RecommendationInputError(
        "Recommendation content action timestamp is outside its bounded horizon",
      )
    }

    const episode =
      parsed.actorClass === "human_anonymous" ||
      parsed.actorClass === "human_signed_in"
        ? await this.deps.prisma.recommendationPlaybackEpisode.findFirst({
            where: {
              sessionDigest: parsed.sessionDigest,
              mediaId: parsed.mediaId,
              state: {
                in: [
                  RecommendationEpisodeState.CLAIMED,
                  RecommendationEpisodeState.FINALIZED,
                  RecommendationEpisodeState.TIMED_OUT,
                ],
              },
              createdAt: {
                gte: new Date(now.getTime() - ACTION_MATCH_WINDOW_MS),
                lte: new Date(occurredAt.getTime() + ACTION_CLOCK_SKEW_MS),
              },
              hardUntil: { gte: occurredAt },
              request: { expiresAt: { gt: now } },
            },
            include: { request: true, item: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          })
        : null
    const lineage =
      episode && episode.generation === episode.request.generation
        ? {
            requestId: episode.requestId,
            itemId: episode.itemId,
            episodeId: episode.id,
            candidateGenerator: episode.item.candidateGenerator,
            expiresAt: episode.request.expiresAt,
            late: occurredAt > episode.activeUntil || now > episode.activeUntil,
          }
        : {
            requestId: null,
            itemId: null,
            episodeId: null,
            candidateGenerator: null,
            expiresAt: new Date(
              now.getTime() + RECOMMENDATION_RAW_RETENTION_DAYS * 86_400_000,
            ),
            late: false,
          }
    const payloadDigest = recommendationEvidenceDigest(parsed)
    const newId = this.deps.newId ?? randomUUID
    const newAuditId = this.deps.newAuditId ?? randomUUID

    return this.deps.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${parsed.sessionDigest}:${parsed.eventId}`}, 372)
        )
      `
      const existing = await tx.recommendationContentAction.findUnique({
        where: {
          sessionDigest_eventId: {
            sessionDigest: parsed.sessionDigest,
            eventId: parsed.eventId,
          },
        },
      })
      if (existing) {
        const status =
          existing.payloadDigest === payloadDigest ? "replay" : "conflict"
        await tx.recommendationContentAction.update({
          where: { id: existing.id },
          data:
            status === "replay"
              ? { replayCount: { increment: 1 } }
              : { conflictCount: { increment: 1 } },
        })
        return {
          actionId: existing.id,
          eventId: parsed.eventId,
          status,
          matched: existing.requestId != null,
          late: existing.late,
        }
      }

      const created = await tx.recommendationContentAction.create({
        data: {
          id: newId(),
          contractVersion: parsed.contractVersion,
          sessionDigest: parsed.sessionDigest,
          eventId: parsed.eventId,
          payloadDigest,
          actionClass: ACTION_CLASS[parsed.actionClass],
          actionKind: ACTION_KIND[parsed.actionKind],
          actorClass: ACTOR_CLASS[parsed.actorClass],
          purpose: PURPOSE[parsed.purpose],
          actionDetail: parsed.actionDetail,
          targetMediaId: parsed.mediaId,
          requestId: lineage.requestId,
          itemId: lineage.itemId,
          episodeId: lineage.episodeId,
          candidateGenerator: lineage.candidateGenerator,
          destinationArtifactType: parsed.destination?.artifactType ?? null,
          destinationArtifactId: parsed.destination?.artifactId ?? null,
          destinationAuditId: parsed.destination ? newAuditId() : null,
          occurredAt,
          receivedAt: now,
          late: lineage.late,
          learningEligible: false,
          expiresAt: lineage.expiresAt,
        },
      })
      return {
        actionId: created.id,
        eventId: parsed.eventId,
        status: "accepted",
        matched: created.requestId != null,
        late: created.late,
      }
    })
  }

  async eraseDestination(input: {
    artifactType: string
    artifactId: string
  }): Promise<number> {
    if (
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.artifactType) ||
      input.artifactId.length < 1 ||
      input.artifactId.length > 191
    ) {
      throw new RecommendationInputError(
        "Recommendation content action destination is invalid",
      )
    }
    const now = this.deps.now?.() ?? new Date()
    const result =
      await this.deps.prisma.recommendationContentAction.updateMany({
        where: {
          destinationArtifactType: input.artifactType,
          destinationArtifactId: input.artifactId,
        },
        data: {
          destinationArtifactType: null,
          destinationArtifactId: null,
          destinationDeletedAt: now,
        },
      })
    return result.count
  }

  private assertCaller(
    caller: Principal | null,
    actorClass: RecommendationContentActionInput["actorClass"],
  ) {
    if (actorClass === "human_anonymous") {
      assertWebRecommendationCaller(caller)
      return
    }
    if (actorClass === "human_signed_in") {
      if (caller?.role !== "WEB_USER")
        throw new RecommendationAuthenticationError()
      return
    }
    if (caller?.role !== "SYSTEM") throw new RecommendationAuthenticationError()
  }

  private assertClassAndKind(input: RecommendationContentActionInput) {
    const valid =
      (input.actionClass === "human_action" &&
        HUMAN_ACTION_KINDS.has(input.actionKind) &&
        (input.actorClass === "human_anonymous" ||
          input.actorClass === "human_signed_in")) ||
      (input.actionClass === "machine_disposition" &&
        input.actionKind === "machine_disposition" &&
        MACHINE_ACTORS.has(input.actorClass)) ||
      (input.actionClass === "reported_value" &&
        input.actionKind === "reported_value" &&
        (input.actorClass === "human_anonymous" ||
          input.actorClass === "human_signed_in"))
    if (!valid) {
      throw new RecommendationInputError(
        "Recommendation content action class and kind are incompatible",
      )
    }
  }
}

export function createRecommendationContentActionService(
  prisma: PrismaClient = defaultPrisma,
) {
  return new RecommendationContentActionService({ prisma })
}
