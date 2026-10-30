import type { PrismaClient } from "@prisma/client"
import type {
  CandidateNomination,
  RecommendationCandidateContext,
} from "./candidate"
import type { CandidatePlatformResult } from "./orchestration"
import type { DirectDeliveryAuthority } from "./promotion/owner-authority"
import type { RecommendationRecentContext } from "./recent-context.service"
import type { ViewingModeAffinity } from "./viewing-mode"

export type OwnerDeliveryAuthority = Readonly<{
  release: DirectDeliveryAuthority
  privacyGeneration: number
}>
type OwnerRequestProfile = Readonly<{
  profileProjectionId: string
  profileTokenDigest: string
  consentReceiptDigest: string
}>
export type OwnerCompositionInput = OwnerRequestProfile &
  Readonly<{
    authority: OwnerDeliveryAuthority
    context: RecommendationCandidateContext
    seedMediaId: string
    semanticNominations: readonly CandidateNomination[]
    profileNominations: readonly CandidateNomination[]
    recentContext: RecommendationRecentContext
    limit: number
    deadlineAt: number
    now: Date
  }>
export type OwnerCompositionResult =
  | Readonly<{
      status: "composed"
      platform: CandidatePlatformResult
      viewingMode: ViewingModeAffinity | null
    }>
  | Readonly<{ status: "fallback"; reason: string }>

export async function resolveDeliveryOwnerAuthority(
  _prisma: PrismaClient,
  _input: OwnerRequestProfile & { now: Date; deadlineAt: number },
): Promise<OwnerDeliveryAuthority | null> {
  return null
}

export async function composeDeliveryOwnerCowatch(
  _prisma: PrismaClient,
  _input: OwnerCompositionInput,
): Promise<OwnerCompositionResult> {
  return { status: "fallback", reason: "behavioral_recommendations_retired" }
}
