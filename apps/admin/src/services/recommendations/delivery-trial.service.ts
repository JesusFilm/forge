import type { PrismaClient } from "@prisma/client"
import type {
  CandidateNomination,
  RecommendationCandidateContext,
} from "./candidate"
import type { ExperimentAssignmentContext } from "./experiment/assignment"
import type { ActiveStudyAuthority } from "./experiment/active-study-authority"
import type { CandidatePlatformResult } from "./orchestration"
import type { RecommendationRecentContext } from "./recent-context.service"
import type { ViewingModeAffinity } from "./viewing-mode"

export type TrialCompositionInput = Readonly<{
  assignment: ExperimentAssignmentContext
  authority: ActiveStudyAuthority
  context: RecommendationCandidateContext
  seedMediaId: string
  profileProjectionId: string
  profileTokenDigest: string
  semanticNominations: readonly CandidateNomination[]
  profileNominations: readonly CandidateNomination[]
  recentContext: RecommendationRecentContext
  limit: number
  deadlineAt: number
  now: Date
}>
export type TrialCompositionResult =
  | {
      status: "composed"
      platform: CandidatePlatformResult
      viewingMode: ViewingModeAffinity | null
    }
  | { status: "fallback"; reason: string }

export async function resolveDeliveryStudyAuthority(
  _prisma: PrismaClient,
  _input: {
    assignment: ExperimentAssignmentContext
    deadlineAt: number
    now: Date
  },
): Promise<ActiveStudyAuthority | null> {
  return null
}

export async function composeDeliveryCowatchTrial(
  _prisma: PrismaClient,
  _input: TrialCompositionInput,
): Promise<TrialCompositionResult> {
  return { status: "fallback", reason: "behavioral_recommendations_retired" }
}
