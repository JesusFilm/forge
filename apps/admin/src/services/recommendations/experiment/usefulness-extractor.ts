import type { Prisma, PrismaClient } from "@prisma/client"
import { refuseBehavioralRecommendations } from "../behavioral-retirement"
import type { UsefulnessSnapshot } from "./usefulness-offline"
import { evaluateUsefulnessSnapshot } from "./usefulness-offline"

export type UsefulnessExtractionInput = {
  experimentId: string
  configurationDigest: string
  enrollmentStart: Date
  enrollmentEnd: Date
  plannedAssignmentsPerArm: number
  minimumUsefulDelta: number | null
}

type RetiredExtraction = {
  snapshot: UsefulnessSnapshot
  sourceAuthorityExpiresAt: Date
  assessment: ReturnType<typeof evaluateUsefulnessSnapshot>
}

/** Historic profile studies remain readable, but no new profile evidence can be extracted. */
export async function extractUsefulnessSnapshot(
  _prisma: PrismaClient,
  _input: UsefulnessExtractionInput,
): Promise<RetiredExtraction> {
  refuseBehavioralRecommendations()
}

export async function extractUsefulnessSnapshotInTransaction(
  _tx: Prisma.TransactionClient,
  _input: UsefulnessExtractionInput,
): Promise<RetiredExtraction> {
  refuseBehavioralRecommendations()
}
