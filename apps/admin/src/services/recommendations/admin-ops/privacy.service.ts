import type { PrismaClient } from "@prisma/client"

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

/** Retired learned-profile rows have no live privacy-health reader. */
export async function loadRecommendationPrivacyHealth(
  _prisma: PrismaClient,
  _window: PrivacyWindow,
): Promise<RecommendationPrivacyHealth> {
  return {
    profiles: {
      active: 0,
      tombstoned: 0,
      expired: 0,
      pendingErasure: 0,
      failedErasure: 0,
    },
    transitions: { grant: 0, reset: 0, withdraw: 0, delete: 0, expire: 0 },
    staleWorkerRejections: 0,
    lastDeletionDrillAt: null,
    latestTransition: null,
  }
}
