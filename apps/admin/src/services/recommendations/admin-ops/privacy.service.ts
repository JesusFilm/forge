import {
  RecommendationProfileErasureState,
  RecommendationProfileState,
  type PrismaClient,
} from "@prisma/client"

type PrivacyWindow = { start: Date; end: Date }

export type RecommendationPrivacyHealth = Readonly<{
  profiles: Readonly<{
    active: number
    tombstoned: number
    expired: number
    pendingErasure: number
    failedErasure: number
  }>
  transitions: Readonly<{
    grant: number
    reset: number
    withdraw: number
    delete: number
    expire: number
  }>
  staleWorkerRejections: number
  lastDeletionDrillAt: Date | null
  latestTransition: Readonly<{
    kind: "grant" | "reset" | "withdraw" | "delete" | "expire"
    fromGeneration: number | null
    toGeneration: number | null
    erasureState: "not_required" | "pending" | "completed" | "failed"
    occurredAt: Date
  }> | null
}>

export async function loadRecommendationPrivacyHealth(
  prisma: PrismaClient,
  window: PrivacyWindow,
): Promise<RecommendationPrivacyHealth> {
  const [
    active,
    tombstoned,
    expired,
    pendingErasure,
    failedErasure,
    aggregate,
    groupedTransitions,
    latestTransition,
  ] = await Promise.all([
    prisma.recommendationProfile.count({
      where: { state: RecommendationProfileState.ACTIVE },
    }),
    prisma.recommendationProfile.count({
      where: { state: RecommendationProfileState.TOMBSTONED },
    }),
    prisma.recommendationProfile.count({
      where: { state: RecommendationProfileState.EXPIRED },
    }),
    prisma.recommendationProfile.count({
      where: { erasureState: RecommendationProfileErasureState.PENDING },
    }),
    prisma.recommendationProfile.count({
      where: { erasureState: RecommendationProfileErasureState.FAILED },
    }),
    prisma.recommendationProfile.aggregate({
      _sum: { staleWorkerRejections: true },
      _max: { deletionDrillAt: true },
    }),
    prisma.recommendationConsentTransition.groupBy({
      by: ["kind"],
      where: {
        occurredAt: { gte: window.start, lt: window.end },
        expiresAt: { gt: window.end },
      },
      _count: { _all: true },
    }),
    prisma.recommendationConsentTransition.findFirst({
      where: {
        occurredAt: { gte: window.start, lt: window.end },
        expiresAt: { gt: window.end },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: {
        kind: true,
        fromGeneration: true,
        toGeneration: true,
        erasureState: true,
        occurredAt: true,
      },
    }),
  ])

  const transitions = {
    grant: 0,
    reset: 0,
    withdraw: 0,
    delete: 0,
    expire: 0,
  }
  for (const row of groupedTransitions) {
    const key = row.kind.toLowerCase() as keyof typeof transitions
    transitions[key] = row._count._all
  }

  return {
    profiles: { active, tombstoned, expired, pendingErasure, failedErasure },
    transitions,
    staleWorkerRejections: aggregate._sum.staleWorkerRejections ?? 0,
    lastDeletionDrillAt: aggregate._max.deletionDrillAt,
    latestTransition: latestTransition
      ? {
          kind: latestTransition.kind.toLowerCase() as
            | "grant"
            | "reset"
            | "withdraw"
            | "delete"
            | "expire",
          fromGeneration: latestTransition.fromGeneration,
          toGeneration: latestTransition.toGeneration,
          erasureState: latestTransition.erasureState.toLowerCase() as
            | "not_required"
            | "pending"
            | "completed"
            | "failed",
          occurredAt: latestTransition.occurredAt,
        }
      : null,
  }
}
