import type { PrismaClient } from "@prisma/client"
import type { RecommendationOpsWindow } from "./shared"

export type RecommendationProfileReconciliationOverview = Readonly<{
  state: "healthy" | "repairing" | "degraded" | "suppressed"
  suppressed: boolean
  currentPointerInvariant: "clean" | "violated"
  counts: Readonly<{
    ineligibleGenerations: number
    affectedPointers: number
    affectedContributions: number
    rebuildCandidates: number
    rebuildBacklog: number
    replacementPublications: number
    staleClaims: number
    reclaimedRuns: number
    terminalRuns: number
    servingFences: number
    affectedRequests: number
    cleanHybridRequests: number
  }> | null
  reasonCodes: ReadonlyArray<Readonly<{ reasonCode: string; count: number }>>
}>

/** The learned-profile reconciliation lane is retired. */
export async function loadRecommendationProfileReconciliationOverview(
  _prisma: Pick<PrismaClient, "$queryRaw">,
  _window: RecommendationOpsWindow,
  _now: Date,
): Promise<RecommendationProfileReconciliationOverview | null> {
  return null
}
