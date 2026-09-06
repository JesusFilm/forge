import { createHash, randomUUID } from "node:crypto"
import {
  RecommendationAuditKind,
  RecommendationExperimentArm,
  RecommendationExperimentAssignmentState,
  RecommendationRequestState,
  type Prisma,
  type PrismaClient,
} from "@prisma/client"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { prisma as defaultPrisma } from "@/db/client"
import {
  MAX_EVIDENCE_EVENTS,
  MAX_EVIDENCE_REQUEST_BYTES,
  RECOMMENDATION_CONTRACTS,
} from "./contracts"
import { assertWebRecommendationCaller } from "./caller"
import {
  isRecommendationAssignmentCapabilityCurrent,
  lockRecommendationAssignmentCapabilityFence,
} from "./assignment-capability"
import {
  RecommendationBindingError,
  RecommendationCapabilityUnavailableError,
  RecommendationInputError,
} from "./errors"
import { createRuntimeRecommendationTokenService } from "./runtime-token"
import { consumeDeliveryCapabilitySubmissions } from "./submission-budget"
import type { DeliveryCapabilityBinding } from "./token.service"
import { RECOMMENDATION_TOKEN_CLOCK_SKEW_SECONDS } from "./token.service"
import { recordFirstEligiblePromotionExposure } from "./promotion/service"
import { resolveActiveRecommendationProfileLink } from "./profiles/active-profile-link"

const Event = z
  .object({
    eventId: z.string().min(1).max(191),
    kind: z.enum(["render", "impression"]),
    occurredAt: z.string().datetime({ offset: true }),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

const Input = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_CONTRACTS.evidence),
    capability: z.string().min(1).max(4096),
    requestId: z.string().min(1).max(191),
    itemId: z.string().min(1).max(191),
    sessionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    events: z.array(Event).min(1).max(MAX_EVIDENCE_EVENTS),
  })
  .strict()

type DeliveryVerifier = {
  verifyDeliveryCapability(
    token: string,
    expected: DeliveryCapabilityBinding,
  ): Promise<{ iat: number; exp: number }>
}

type EvidenceDependencies = {
  prisma: PrismaClient
  tokenService: DeliveryVerifier
  now?: () => Date
  dispatchProfileFeedback?: (input: {
    sessionDigest: string
    profileId: string
    privacyGeneration: number
    evidenceWatermark: Date
  }) => Promise<unknown>
}

export type RecommendationEvidenceReceipt = {
  eventId: string
  status: "accepted" | "replay" | "conflict"
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export function recommendationEvidenceDigest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex")
}

export async function recordRecommendationConflict(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string
    capabilityJti: string
    eventId: string
    acceptedDigest: string
    rejectedDigest: string
    expiresAt: Date
  },
) {
  await tx.$queryRaw`
    SELECT upsert_recommendation_conflict(
      ${randomUUID()}, ${input.requestId}, ${input.capabilityJti}, ${input.eventId},
      ${input.acceptedDigest}, ${input.rejectedDigest}, ${input.expiresAt}
    )
  `
}

export async function lockRecommendationItemEvidence(
  tx: Prisma.TransactionClient,
  itemId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${itemId}, 369))
  `
}

export class RecommendationEvidenceService {
  constructor(private readonly deps: EvidenceDependencies) {}

  async record({
    caller,
    ...payload
  }: {
    caller: Principal | null
    contractVersion: string
    capability: string
    requestId: string
    itemId: string
    sessionDigest: string
    events: Array<{
      eventId: string
      kind: "render" | "impression"
      occurredAt: string
      payload: Record<string, unknown>
    }>
  }): Promise<RecommendationEvidenceReceipt[]> {
    assertWebRecommendationCaller(caller)
    if (
      Buffer.byteLength(JSON.stringify(payload)) > MAX_EVIDENCE_REQUEST_BYTES
    ) {
      throw new RecommendationInputError(
        "Recommendation evidence request is too large",
      )
    }
    const input = Input.parse(payload)
    const item = await this.deps.prisma.recommendationServedItem.findUnique({
      where: { id: input.itemId },
      include: {
        request: {
          include: {
            experimentAssignment: {
              include: { experiment: true, profile: true },
            },
            promotionSlateFence: true,
          },
        },
      },
    })
    const now = this.deps.now?.() ?? new Date()
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
        "Recommendation evidence binding is invalid",
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
      attempts: input.events.length,
      expiresAt: item.request.expiresAt,
    })
    for (const event of input.events) {
      const occurred = Math.floor(new Date(event.occurredAt).getTime() / 1_000)
      if (
        occurred < verified.iat - RECOMMENDATION_TOKEN_CLOCK_SKEW_SECONDS ||
        occurred > verified.exp
      ) {
        await this.recordCommittedRejection(
          item.requestId,
          item.request.expiresAt,
          "delivery_timestamp_invalid",
        )
        throw new RecommendationInputError(
          "Recommendation evidence timestamp is invalid",
        )
      }
      if (
        event.kind === "impression" &&
        event.payload.visibilityPolicy !== RECOMMENDATION_CONTRACTS.surface
      ) {
        await this.recordCommittedRejection(
          item.requestId,
          item.request.expiresAt,
          "delivery_visibility_policy_invalid",
        )
        throw new RecommendationInputError(
          "Recommendation visibility policy is invalid",
        )
      }
    }

    const result = await this.deps.prisma.$transaction(async (tx) => {
      if (
        !(await lockRecommendationAssignmentCapabilityFence(
          tx,
          assignment,
          now,
        ))
      ) {
        throw new RecommendationBindingError(
          "Recommendation evidence binding is invalid",
        )
      }
      await lockRecommendationItemEvidence(tx, item.id)
      const receipts: RecommendationEvidenceReceipt[] = []
      let reconciledSelection = false
      for (const event of input.events) {
        const digest = recommendationEvidenceDigest(event)
        const existing =
          event.kind === "render"
            ? await tx.recommendationRenderedFact.findUnique({
                where: { itemId: item.id },
              })
            : await tx.recommendationImpression.findUnique({
                where: { itemId: item.id },
              })
        if (existing) {
          if (existing.payloadDigest === digest) {
            if (event.kind === "impression") {
              const reconciliation =
                await tx.recommendationSelection.updateMany({
                  where: {
                    requestId: item.requestId,
                    itemId: item.id,
                    attributionEligibleAt: null,
                  },
                  data: { attributionEligibleAt: now },
                })
              reconciledSelection ||= reconciliation.count === 1
            }
            await tx.recommendationEvidenceAudit.create({
              data: {
                requestId: item.requestId,
                kind: RecommendationAuditKind.REPLAY,
                reasonCode: `${event.kind}_replay`,
                expiresAt: item.request.expiresAt,
              },
            })
            receipts.push({ eventId: event.eventId, status: "replay" })
          } else {
            await recordRecommendationConflict(tx, {
              requestId: item.requestId,
              capabilityJti,
              eventId: event.eventId,
              acceptedDigest: existing.payloadDigest,
              rejectedDigest: digest,
              expiresAt: item.request.expiresAt,
            })
            receipts.push({ eventId: event.eventId, status: "conflict" })
          }
          continue
        }
        const common = {
          requestId: item.requestId,
          itemId: item.id,
          capabilityJti,
          eventId: event.eventId,
          payloadDigest: digest,
          occurredAt: new Date(event.occurredAt),
          receivedAt: now,
          expiresAt: item.request.expiresAt,
        }
        if (event.kind === "render") {
          await tx.recommendationRenderedFact.create({ data: common })
        } else {
          await tx.recommendationImpression.create({
            data: {
              ...common,
              visibilityPolicy: RECOMMENDATION_CONTRACTS.surface,
            },
          })
          const reconciliation = await tx.recommendationSelection.updateMany({
            where: {
              requestId: item.requestId,
              itemId: item.id,
              attributionEligibleAt: null,
            },
            data: { attributionEligibleAt: now },
          })
          reconciledSelection ||= reconciliation.count === 1
          if (
            !item.request.promotionSlateFence &&
            assignment?.state ===
              RecommendationExperimentAssignmentState.ACTIVE &&
            assignment.generation === assignment.experiment.generation &&
            assignment.configurationDigest ===
              assignment.experiment.configurationDigest
          ) {
            const exposure =
              await tx.recommendationExperimentExposure.createMany({
                data: [
                  {
                    id: randomUUID(),
                    assignmentId: assignment.id,
                    requestId: item.requestId,
                    itemId: item.id,
                    eventId: event.eventId,
                    arm: assignment.arm,
                    effectiveManifestId:
                      assignment.arm === RecommendationExperimentArm.CHALLENGER
                        ? assignment.experiment.challengerManifestId
                        : assignment.experiment.controlManifestId,
                    assignmentProbability: assignment.assignmentProbability,
                    payloadDigest: digest,
                    occurredAt: new Date(event.occurredAt),
                    receivedAt: now,
                    expiresAt: item.request.expiresAt,
                  },
                ],
                skipDuplicates: true,
              })
            if (exposure.count === 1) {
              await recordFirstEligiblePromotionExposure(tx, {
                effectiveManifestId:
                  assignment.arm === RecommendationExperimentArm.CHALLENGER
                    ? assignment.experiment.challengerManifestId
                    : assignment.experiment.controlManifestId,
                requestId: item.requestId,
                itemId: item.id,
                occurredAt: new Date(event.occurredAt),
                receivedAt: now,
              })
            }
          }
        }
        await tx.recommendationEvidenceAudit.create({
          data: {
            requestId: item.requestId,
            kind: RecommendationAuditKind.EVIDENCE_SUCCESS,
            reasonCode: event.kind,
            expiresAt: item.request.expiresAt,
          },
        })
        receipts.push({ eventId: event.eventId, status: "accepted" })
      }
      return { receipts, reconciledSelection }
    })
    if (result.reconciledSelection) {
      const activeProfile = await resolveActiveRecommendationProfileLink(
        this.deps.prisma,
        { sessionDigest: item.request.sessionDigest, now },
      )
      if (activeProfile) {
        void this.deps
          .dispatchProfileFeedback?.({
            sessionDigest: item.request.sessionDigest,
            profileId: activeProfile.profileId,
            privacyGeneration: activeProfile.privacyGeneration,
            evidenceWatermark: now,
          })
          .catch(() => {
            // Evidence acknowledgement and navigation remain fail-open when
            // the independently durable projection workflow is unavailable.
          })
      }
    }
    return result.receipts
  }

  private async recordCommittedRejection(
    requestId: string,
    expiresAt: Date,
    reasonCode: string,
  ): Promise<void> {
    await this.deps.prisma.recommendationEvidenceAudit.create({
      data: {
        requestId,
        kind: RecommendationAuditKind.COMMITTED_REJECTION,
        reasonCode,
        expiresAt,
      },
    })
  }
}

export function createRecommendationEvidenceService(
  prisma: PrismaClient = defaultPrisma,
) {
  const tokenService = createRuntimeRecommendationTokenService(prisma)
  if (!tokenService) throw new RecommendationCapabilityUnavailableError()
  return new RecommendationEvidenceService({
    prisma,
    tokenService,
    dispatchProfileFeedback: async (input) => {
      const { dispatchRecommendationProfileFeedback } =
        await import("./profiles/job")
      return dispatchRecommendationProfileFeedback(input)
    },
  })
}
