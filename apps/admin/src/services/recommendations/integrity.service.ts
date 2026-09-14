import { createHash, randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationContentActionActorClass,
  RecommendationEligibilitySourceType,
  RecommendationEligibilityState,
  RecommendationEpisodeState,
  type PrismaClient,
} from "@prisma/client"
import { prisma as defaultPrisma } from "@/db/client"
import {
  ACTIVE_WATCH_PROXY_VERSION,
  RECOMMENDATION_CONTRACTS,
} from "./contracts"
import { RecommendationInputError } from "./errors"
import {
  RECOMMENDATION_INTEGRITY_POLICY_VERSION,
  decideRecommendationEligibility,
  type RecommendationEligibilityScope,
  type RecommendationEligibilityState as PolicyEligibilityState,
  type RecommendationIntegrityDecision,
} from "./integrity-policy"
import { withRecommendationSerializableRetry } from "./transaction-retry"

const ACTOR_CLASS = {
  human_anonymous: RecommendationContentActionActorClass.HUMAN_ANONYMOUS,
  human_signed_in: RecommendationContentActionActorClass.HUMAN_SIGNED_IN,
  machine: RecommendationContentActionActorClass.MACHINE,
  internal: RecommendationContentActionActorClass.INTERNAL,
  test: RecommendationContentActionActorClass.TEST,
} as const

const STATE = {
  eligible: RecommendationEligibilityState.ELIGIBLE,
  excluded: RecommendationEligibilityState.EXCLUDED,
  quarantined: RecommendationEligibilityState.QUARANTINED,
} as const

type IntegrityDependencies = {
  prisma: PrismaClient
  now?: () => Date
  newId?: () => string
}

export type RecommendationEligibilityReceipt = Readonly<{
  id: string
  sourceKey: string
  policyVersion: string
  revision: number
  state: PolicyEligibilityState
  reasonCodes: string[]
  eligibleScopes: RecommendationEligibilityScope[]
  contributionWeight: number
  inputDigest: string
  evidenceWatermark: Date | null
}>

type SourceMeasures = Readonly<{
  contributionOrdinal: number
  distinctSupport: number
  identityConcentration: number
}>

/**
 * Projection-side classifier. Finalized outcomes are classified by their
 * durable consumer; eligible selection/impression pairs are classified by a
 * fail-open post-commit task. Reconciliation can replay either path from the
 * same immutable envelope. No method participates in recommendation delivery
 * or player startup.
 */
export class RecommendationIntegrityService {
  constructor(private readonly deps: IntegrityDependencies) {}

  async classifyPlaybackOutcome(
    outcomeId: string,
  ): Promise<RecommendationEligibilityReceipt> {
    const sourceKey = sourceKeyFor("playback_outcome", outcomeId)
    return withRecommendationSerializableRetry(() =>
      this.deps.prisma.$transaction(
        async (tx) => {
          await lockSource(tx, sourceKey)
          const outcome = await tx.recommendationOutcomeRevision.findUnique({
            where: { id: outcomeId },
            include: {
              supersededBy: { select: { id: true } },
              episode: {
                select: {
                  id: true,
                  sessionDigest: true,
                  mediaId: true,
                  capabilityJti: true,
                  state: true,
                  finalizedAt: true,
                  transportReplayCount: true,
                  replayCount: true,
                  conflictCount: true,
                  createdAt: true,
                  facts: { select: { late: true } },
                  transportReplayReceipts: { select: { id: true } },
                },
              },
              request: {
                select: {
                  promotionSlateFence: {
                    select: { reasonCode: true, fencedAt: true },
                  },
                },
              },
            },
          })
          if (!outcome) {
            throw new RecommendationInputError(
              "Recommendation playback outcome does not exist",
            )
          }
          const measures = await measurePlaybackSource(tx, outcome.episode)
          const previous = await tx.recommendationEligibilityDecision.findFirst(
            {
              where: {
                sourceKey,
                policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
                isCurrent: true,
              },
              select: { reasonCodes: true },
            },
          )
          const legacyReplayRequiresProof =
            previous?.reasonCodes.includes("replay_velocity_exceeded") === true
          const replayProofComplete =
            outcome.episode.transportReplayCount === 0 ||
            outcome.episode.transportReplayReceipts.length >=
              outcome.episode.transportReplayCount
          const evidenceWatermark = latestDate([
            outcome.createdAt,
            outcome.episode.finalizedAt,
            outcome.request?.promotionSlateFence?.fencedAt,
          ])
          const decision = outcome.request?.promotionSlateFence
            ? rollbackFencedDecision()
            : outcome.classifierVersion !== ACTIVE_WATCH_PROXY_VERSION ||
                outcome.episode.state !==
                  RecommendationEpisodeState.FINALIZED ||
                outcome.episode.finalizedAt == null
              ? excludedDecision("finalized_active_watch_outcome_required")
              : legacyReplayRequiresProof && !replayProofComplete
                ? excludedDecision("legacy_transport_receipt_evidence_missing")
                : decideRecommendationEligibility({
                    sourceType: "playback_outcome",
                    actorClass: "human_anonymous",
                    qualifiedView: outcome.qualifiedView,
                    baseWeight: outcome.viewQualityWeight ?? 0,
                    late: outcome.episode.facts.some((fact) => fact.late),
                    // Playback exact-payload replays are acknowledgement recovery,
                    // not evidence tampering. Same-ID/different-payload facts are
                    // represented by conflictCount and remain fail-closed.
                    replayCount: outcome.episode.replayCount,
                    conflictCount: outcome.episode.conflictCount,
                    contributionOrdinal: measures.contributionOrdinal,
                    distinctAnonymousSupport: measures.distinctSupport,
                    identityConcentration: measures.identityConcentration,
                    superseded: outcome.supersededBy != null,
                  })

          const inputDigest = eligibilityInputDigest({
            sourceType: "playback_outcome",
            outcomeId: outcome.id,
            classifierVersion: outcome.classifierVersion,
            outcomeRevision: outcome.revision,
            outcomeInputDigest: outcome.inputDigest,
            qualifiedView: outcome.qualifiedView,
            baseWeight: outcome.viewQualityWeight ?? 0,
            finalizedAt: outcome.episode.finalizedAt,
            late: outcome.episode.facts.some((fact) => fact.late),
            replayCount: outcome.episode.replayCount,
            transportReplayCount: outcome.episode.transportReplayCount,
            transportReplayReceiptCount:
              outcome.episode.transportReplayReceipts.length,
            conflictCount: outcome.episode.conflictCount,
            superseded: outcome.supersededBy != null,
            promotionFence:
              outcome.request?.promotionSlateFence?.reasonCode ?? null,
            measures,
            decision,
          })

          return writeDecision(tx, {
            id: this.deps.newId?.() ?? randomUUID(),
            sourceKey,
            sourceType: RecommendationEligibilitySourceType.PLAYBACK_OUTCOME,
            outcomeId: outcome.id,
            contentActionId: null,
            selectionId: null,
            actorClass: RecommendationContentActionActorClass.HUMAN_ANONYMOUS,
            measures,
            decision,
            inputDigest,
            evidenceWatermark,
            decidedAt: this.deps.now?.() ?? new Date(),
            expiresAt: outcome.expiresAt,
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    )
  }

  async classifyContentAction(
    actionId: string,
  ): Promise<RecommendationEligibilityReceipt> {
    const sourceKey = sourceKeyFor("content_action", actionId)
    return withRecommendationSerializableRetry(() =>
      this.deps.prisma.$transaction(
        async (tx) => {
          await lockSource(tx, sourceKey)
          const action = await tx.recommendationContentAction.findUnique({
            where: { id: actionId },
            include: {
              request: {
                select: {
                  promotionSlateFence: {
                    select: { reasonCode: true, fencedAt: true },
                  },
                },
              },
            },
          })
          if (!action) {
            throw new RecommendationInputError(
              "Recommendation content action does not exist",
            )
          }
          const measures = await measureActionSource(tx, action)
          const actorClass = enumToken(action.actorClass)
          const decision = action.request?.promotionSlateFence
            ? rollbackFencedDecision()
            : decideRecommendationEligibility({
                sourceType: "content_action",
                actorClass,
                qualifiedView: true,
                baseWeight: actionWeight(enumToken(action.actionClass)),
                late: action.late,
                replayCount: action.replayCount,
                conflictCount: action.conflictCount,
                contributionOrdinal: measures.contributionOrdinal,
                distinctAnonymousSupport: measures.distinctSupport,
                identityConcentration: measures.identityConcentration,
                actionClass: enumToken(action.actionClass),
                actionDetail: action.actionDetail,
              })
          const evidenceWatermark = latestDate([
            action.receivedAt,
            action.request?.promotionSlateFence?.fencedAt,
          ])
          const inputDigest = eligibilityInputDigest({
            sourceType: "content_action",
            actionId: action.id,
            actionClass: enumToken(action.actionClass),
            actionDetail: action.actionDetail,
            actorClass,
            late: action.late,
            replayCount: action.replayCount,
            conflictCount: action.conflictCount,
            promotionFence:
              action.request?.promotionSlateFence?.reasonCode ?? null,
            measures,
            decision,
          })
          return writeDecision(tx, {
            id: this.deps.newId?.() ?? randomUUID(),
            sourceKey,
            sourceType: RecommendationEligibilitySourceType.CONTENT_ACTION,
            outcomeId: null,
            contentActionId: action.id,
            selectionId: null,
            actorClass: ACTOR_CLASS[actorClass],
            measures,
            decision,
            inputDigest,
            evidenceWatermark,
            decidedAt: this.deps.now?.() ?? new Date(),
            expiresAt: action.expiresAt,
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    )
  }

  async classifySelection(
    selectionId: string,
  ): Promise<RecommendationEligibilityReceipt> {
    const sourceKey = sourceKeyFor("selection", selectionId)
    const now = this.deps.now?.() ?? new Date()
    return withRecommendationSerializableRetry(() =>
      this.deps.prisma.$transaction(
        async (tx) => {
          await lockSource(tx, sourceKey)
          const selection = await tx.recommendationSelection.findUnique({
            where: { id: selectionId },
            include: {
              request: {
                select: {
                  sessionDigest: true,
                  surfaceVersion: true,
                  promotionSlateFence: {
                    select: { reasonCode: true, fencedAt: true },
                  },
                },
              },
              item: { select: { targetMediaId: true } },
            },
          })
          if (!selection) {
            throw new RecommendationInputError(
              "Recommendation selection does not exist",
            )
          }
          const impression = await tx.recommendationImpression.findUnique({
            where: {
              requestId_itemId: {
                requestId: selection.requestId,
                itemId: selection.itemId,
              },
            },
            select: {
              id: true,
              capabilityJti: true,
              eventId: true,
              payloadDigest: true,
              visibilityPolicy: true,
              receivedAt: true,
              expiresAt: true,
            },
          })
          const conflictCount = await tx.recommendationConflict.count({
            where: {
              OR: [
                {
                  capabilityJti: selection.capabilityJti,
                  eventId: selection.eventId,
                },
                ...(impression
                  ? [
                      {
                        capabilityJti: impression.capabilityJti,
                        eventId: impression.eventId,
                      },
                    ]
                  : []),
              ],
            },
          })
          const measures = await measureSelectionSource(tx, selection)
          const hasEligibleImpression =
            impression != null &&
            impression.visibilityPolicy === selection.request.surfaceVersion &&
            [RECOMMENDATION_CONTRACTS.surface, "watch-for-you-v1"].includes(
              impression.visibilityPolicy,
            ) &&
            selection.attributionEligibleAt != null &&
            impression.expiresAt >= selection.attributionEligibleAt &&
            impression.expiresAt > now
          const decision = selection.request.promotionSlateFence
            ? rollbackFencedDecision()
            : !hasEligibleImpression
              ? excludedDecision("eligible_impression_required")
              : decideRecommendationEligibility({
                  sourceType: "selection",
                  actorClass: "human_anonymous",
                  qualifiedView: true,
                  baseWeight: 1,
                  late: false,
                  replayCount: 0,
                  conflictCount,
                  contributionOrdinal: measures.contributionOrdinal,
                  distinctAnonymousSupport: measures.distinctSupport,
                  identityConcentration: measures.identityConcentration,
                })
          const evidenceWatermark = latestDate([
            selection.receivedAt,
            selection.attributionEligibleAt,
            impression?.receivedAt,
            selection.request.promotionSlateFence?.fencedAt,
          ])
          const inputDigest = eligibilityInputDigest({
            sourceType: "selection",
            selectionId: selection.id,
            selectionPayloadDigest: selection.payloadDigest,
            attributionEligibleAt: selection.attributionEligibleAt,
            impressionId: impression?.id ?? null,
            impressionPayloadDigest: impression?.payloadDigest ?? null,
            visibilityPolicy: impression?.visibilityPolicy ?? null,
            conflictCount,
            promotionFence:
              selection.request.promotionSlateFence?.reasonCode ?? null,
            measures,
            decision,
          })
          return writeDecision(tx, {
            id: this.deps.newId?.() ?? randomUUID(),
            sourceKey,
            sourceType: RecommendationEligibilitySourceType.SELECTION,
            outcomeId: null,
            contentActionId: null,
            selectionId: selection.id,
            actorClass: RecommendationContentActionActorClass.HUMAN_ANONYMOUS,
            measures,
            decision,
            inputDigest,
            evidenceWatermark,
            decidedAt: now,
            expiresAt: selection.expiresAt,
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    )
  }
}

async function measurePlaybackSource(
  tx: Prisma.TransactionClient,
  episode: {
    id: string
    sessionDigest: string
    mediaId: string
    createdAt: Date
  },
): Promise<SourceMeasures> {
  const pair = {
    sessionDigest: episode.sessionDigest,
    mediaId: episode.mediaId,
  }
  const [contributionOrdinal, distinctRows, targetCount, identityCount] =
    await Promise.all([
      tx.recommendationPlaybackEpisode.count({
        where: {
          ...pair,
          OR: [
            { createdAt: { lt: episode.createdAt } },
            { createdAt: episode.createdAt, id: { lte: episode.id } },
          ],
        },
      }),
      tx.recommendationPlaybackEpisode.findMany({
        where: { mediaId: episode.mediaId },
        select: { sessionDigest: true },
        distinct: ["sessionDigest"],
        take: 100,
      }),
      tx.recommendationPlaybackEpisode.count({
        where: { mediaId: episode.mediaId },
      }),
      tx.recommendationPlaybackEpisode.count({ where: pair }),
    ])
  return measures(
    contributionOrdinal,
    distinctRows.length,
    identityCount,
    targetCount,
  )
}

async function measureActionSource(
  tx: Prisma.TransactionClient,
  action: {
    id: string
    sessionDigest: string
    targetMediaId: string
    occurredAt: Date
  },
): Promise<SourceMeasures> {
  const pair = {
    sessionDigest: action.sessionDigest,
    targetMediaId: action.targetMediaId,
  }
  const [contributionOrdinal, distinctRows, targetCount, identityCount] =
    await Promise.all([
      tx.recommendationContentAction.count({
        where: {
          ...pair,
          OR: [
            { occurredAt: { lt: action.occurredAt } },
            { occurredAt: action.occurredAt, id: { lte: action.id } },
          ],
        },
      }),
      tx.recommendationContentAction.findMany({
        where: { targetMediaId: action.targetMediaId },
        select: { sessionDigest: true },
        distinct: ["sessionDigest"],
        take: 100,
      }),
      tx.recommendationContentAction.count({
        where: { targetMediaId: action.targetMediaId },
      }),
      tx.recommendationContentAction.count({ where: pair }),
    ])
  return measures(
    contributionOrdinal,
    distinctRows.length,
    identityCount,
    targetCount,
  )
}

async function measureSelectionSource(
  tx: Prisma.TransactionClient,
  selection: {
    id: string
    occurredAt: Date
    request: { sessionDigest: string }
    item: { targetMediaId: string }
  },
): Promise<SourceMeasures> {
  const pair = {
    request: { sessionDigest: selection.request.sessionDigest },
    item: { targetMediaId: selection.item.targetMediaId },
  }
  const [contributionOrdinal, distinctRows, targetCount, identityCount] =
    await Promise.all([
      tx.recommendationSelection.count({
        where: {
          ...pair,
          OR: [
            { occurredAt: { lt: selection.occurredAt } },
            { occurredAt: selection.occurredAt, id: { lte: selection.id } },
          ],
        },
      }),
      tx.recommendationSelection.findMany({
        where: { item: { targetMediaId: selection.item.targetMediaId } },
        select: { request: { select: { sessionDigest: true } } },
        distinct: ["requestId"],
        take: 100,
      }),
      tx.recommendationSelection.count({
        where: { item: { targetMediaId: selection.item.targetMediaId } },
      }),
      tx.recommendationSelection.count({ where: pair }),
    ])
  return measures(
    contributionOrdinal,
    new Set(distinctRows.map((row) => row.request.sessionDigest)).size,
    identityCount,
    targetCount,
  )
}

function measures(
  contributionOrdinal: number,
  distinctSupport: number,
  identityCount: number,
  targetCount: number,
): SourceMeasures {
  return {
    contributionOrdinal: Math.max(1, contributionOrdinal),
    distinctSupport,
    identityConcentration:
      targetCount > 0 ? Math.min(1, identityCount / targetCount) : 0,
  }
}

function rollbackFencedDecision(): RecommendationIntegrityDecision {
  return {
    state: "excluded",
    reasonCodes: ["promotion_rollback"],
    eligibleScopes: [],
    contributionWeight: 0,
  }
}

function excludedDecision(reasonCode: string): RecommendationIntegrityDecision {
  return {
    state: "excluded",
    reasonCodes: [reasonCode],
    eligibleScopes: [],
    contributionWeight: 0,
  }
}

async function writeDecision(
  tx: Prisma.TransactionClient,
  input: {
    id: string
    sourceKey: string
    sourceType: RecommendationEligibilitySourceType
    outcomeId: string | null
    contentActionId: string | null
    selectionId: string | null
    actorClass: RecommendationContentActionActorClass
    measures: SourceMeasures
    decision: RecommendationIntegrityDecision
    inputDigest: string
    evidenceWatermark: Date | null
    decidedAt: Date
    expiresAt: Date
  },
): Promise<RecommendationEligibilityReceipt> {
  const previous = await tx.recommendationEligibilityDecision.findFirst({
    where: {
      sourceKey: input.sourceKey,
      policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
    },
    orderBy: { revision: "desc" },
    select: {
      id: true,
      revision: true,
      inputDigest: true,
      state: true,
      reasonCodes: true,
      eligibleScopes: true,
      contributionWeight: true,
      evidenceWatermark: true,
    },
  })
  if (previous?.inputDigest === input.inputDigest) {
    return {
      id: previous.id,
      sourceKey: input.sourceKey,
      policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
      revision: previous.revision,
      state: enumToken(previous.state),
      reasonCodes: previous.reasonCodes,
      eligibleScopes:
        previous.eligibleScopes as RecommendationEligibilityScope[],
      contributionWeight: previous.contributionWeight,
      inputDigest: previous.inputDigest,
      evidenceWatermark: previous.evidenceWatermark,
    }
  }
  const revision = (previous?.revision ?? 0) + 1
  await tx.recommendationEligibilityDecision.updateMany({
    where: {
      sourceKey: input.sourceKey,
      policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
      isCurrent: true,
    },
    data: { isCurrent: false },
  })
  const created = await tx.recommendationEligibilityDecision.create({
    data: {
      id: input.id,
      sourceKey: input.sourceKey,
      sourceType: input.sourceType,
      outcomeId: input.outcomeId,
      contentActionId: input.contentActionId,
      selectionId: input.selectionId,
      policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
      revision,
      isCurrent: true,
      actorClass: input.actorClass,
      state: STATE[input.decision.state],
      reasonCodes: input.decision.reasonCodes,
      eligibleScopes: input.decision.eligibleScopes,
      contributionWeight: input.decision.contributionWeight,
      contributionOrdinal: input.measures.contributionOrdinal,
      distinctSupport: input.measures.distinctSupport,
      identityConcentration: input.measures.identityConcentration,
      inputDigest: input.inputDigest,
      evidenceWatermark: input.evidenceWatermark,
      decidedAt: input.decidedAt,
      expiresAt: input.expiresAt,
    },
  })
  return {
    id: created.id,
    sourceKey: input.sourceKey,
    policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
    revision,
    ...input.decision,
    inputDigest: input.inputDigest,
    evidenceWatermark: input.evidenceWatermark,
  }
}

function sourceKeyFor(
  sourceType: "playback_outcome" | "content_action" | "selection",
  id: string,
) {
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(id)) {
    throw new RecommendationInputError(
      "Recommendation eligibility source is invalid",
    )
  }
  return `${sourceType}:${id}`
}

function eligibilityInputDigest(input: object): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex")
}

function latestDate(values: Array<Date | null | undefined>): Date | null {
  const timestamps = values
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime())
  return timestamps.length === 0 ? null : new Date(Math.max(...timestamps))
}

async function lockSource(tx: Prisma.TransactionClient, sourceKey: string) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${sourceKey}, 376))
  `
}

function enumToken<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>
}

function actionWeight(actionClass: string): number {
  if (actionClass === "machine_disposition") return 0
  if (actionClass === "reported_value") return 0.5
  return 1
}

export function createRecommendationIntegrityService(
  prisma: PrismaClient = defaultPrisma,
) {
  return new RecommendationIntegrityService({ prisma })
}
