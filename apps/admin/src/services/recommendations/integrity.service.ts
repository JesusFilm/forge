import { randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationContentActionActorClass,
  RecommendationEligibilitySourceType,
  RecommendationEligibilityState,
  type PrismaClient,
} from "@prisma/client"
import { prisma as defaultPrisma } from "@/db/client"
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
}>

type SourceMeasures = Readonly<{
  contributionOrdinal: number
  distinctSupport: number
  identityConcentration: number
}>

/**
 * Projection-side classifier. Ingestion never calls this implicitly: accepted
 * pre-policy evidence remains pending until a workflow explicitly classifies
 * or reclassifies the source. No method participates in recommendation
 * delivery or player startup.
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
                  replayCount: true,
                  conflictCount: true,
                  createdAt: true,
                  facts: { select: { late: true } },
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
          const decision = outcome.request?.promotionSlateFence
            ? rollbackFencedDecision()
            : decideRecommendationEligibility({
                sourceType: "playback_outcome",
                actorClass: "human_anonymous",
                qualifiedView: outcome.qualifiedView,
                baseWeight: outcome.viewQualityWeight ?? 0,
                late: outcome.episode.facts.some((fact) => fact.late),
                replayCount: outcome.episode.replayCount,
                conflictCount: outcome.episode.conflictCount,
                contributionOrdinal: measures.contributionOrdinal,
                distinctAnonymousSupport: measures.distinctSupport,
                identityConcentration: measures.identityConcentration,
                superseded: outcome.supersededBy != null,
              })

          return writeDecision(tx, {
            id: this.deps.newId?.() ?? randomUUID(),
            sourceKey,
            sourceType: RecommendationEligibilitySourceType.PLAYBACK_OUTCOME,
            outcomeId: outcome.id,
            contentActionId: null,
            actorClass: RecommendationContentActionActorClass.HUMAN_ANONYMOUS,
            measures,
            decision,
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
          return writeDecision(tx, {
            id: this.deps.newId?.() ?? randomUUID(),
            sourceKey,
            sourceType: RecommendationEligibilitySourceType.CONTENT_ACTION,
            outcomeId: null,
            contentActionId: action.id,
            actorClass: ACTOR_CLASS[actorClass],
            measures,
            decision,
            decidedAt: this.deps.now?.() ?? new Date(),
            expiresAt: action.expiresAt,
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

async function writeDecision(
  tx: Prisma.TransactionClient,
  input: {
    id: string
    sourceKey: string
    sourceType: RecommendationEligibilitySourceType
    outcomeId: string | null
    contentActionId: string | null
    actorClass: RecommendationContentActionActorClass
    measures: SourceMeasures
    decision: RecommendationIntegrityDecision
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
    select: { revision: true },
  })
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
  }
}

function sourceKeyFor(
  sourceType: "playback_outcome" | "content_action",
  id: string,
) {
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(id)) {
    throw new RecommendationInputError(
      "Recommendation eligibility source is invalid",
    )
  }
  return `${sourceType}:${id}`
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
