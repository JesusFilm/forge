import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import type { SceneRecommendation } from "@/services/scene-recommendations.service"
import type { RecommendationDeliveryAdmission } from "./admission"
import type {
  RecommendationAssignmentLane,
  RecommendationCandidateContributor,
  RecommendationExecutionMode,
  RecommendationShortfallReason,
} from "./contracts"
import { RECOMMENDATION_CONTRACTS } from "./contracts"
import type { SemanticCandidatePoolItem } from "./candidate"
import type { LiveProfileCandidateResult } from "./candidates/profile-candidate.service"
import type { ExperimentAssignmentResolution } from "./experiment/assignment"
import type { RecommendationServingState } from "./manifest.service"
import type { RecommendationRecentContext } from "./recent-context.service"
import type { DeliveryCapabilityBinding } from "./token.service"

export type DeliveryTokenService = {
  activeKid: string
  signDeliveryCapability(binding: DeliveryCapabilityBinding): Promise<string>
}

export type SemanticRecommendationDeliveryItem = SceneRecommendation & {
  id: string
  position: number
  targetMediaId: string
  canonicalHref: string
  candidateGenerator: "semantic" | "multi-interest-profile"
  contributors: RecommendationCandidateContributor[]
  capability: string
}

export type SemanticRecommendationDelivery = {
  contractVersion: typeof RECOMMENDATION_CONTRACTS.delivery
  surfaceVersion: typeof RECOMMENDATION_CONTRACTS.surface
  strategyVersion: typeof RECOMMENDATION_CONTRACTS.strategy
  classifierVersion: typeof RECOMMENDATION_CONTRACTS.outcome
  requestId: string | null
  result: "served" | "fallback" | "empty" | "unavailable"
  reason: string | null
  expiresAt: string | null
  requestedCount?: number
  composedCount?: number
  shortfallReason?: RecommendationShortfallReason | null
  items: SemanticRecommendationDeliveryItem[]
  personalization?: RecommendationPersonalizationDelivery | null
}

export type RecommendationPersonalizationDelivery = Readonly<{
  contractVersion: "anonymous-profile-personalization-v1"
  lane: RecommendationAssignmentLane
  executionMode?: RecommendationExecutionMode
  effectiveManifestId: string
  profileState: "session" | "durable" | null
  projectionVersion: string | null
  projectionGeneration: number | null
  interestCount: number
  sessionIntentPresent: boolean
  reason: string | null
}>

export type DeliveryDependencies = {
  prisma: PrismaClient
  admission: RecommendationDeliveryAdmission
  getServingState(input: {
    deadlineAt: number
  }): Promise<RecommendationServingState>
  retrieve(input: {
    seedMediaId: string
    locale: string
    audioLanguageSlug: string
    limit: number
    deadlineAt: number
  }): Promise<SemanticCandidatePoolItem[]>
  recheckCached(
    items: SemanticCandidatePoolItem[],
    input: {
      locale: string
      audioLanguageSlug: string
      deadlineAt: number
    },
  ): Promise<SemanticCandidatePoolItem[]>
  orchestrate?: typeof import("./orchestration").runSemanticCandidatePlatform
  orchestrateHybrid?: typeof import("./orchestration").runCandidatePlatform
  authorizeProfile?: (input: {
    consentReceiptDigest: string
    profileTokenDigest: string
    now: Date
    deadlineAt: number
  }) => Promise<boolean>
  assignExperiment?: (input: {
    surfaceVersion: string
    sessionDigest: string
    profileTokenDigest: string | null
    eligibleHuman: boolean
    now: Date
    deadlineAt: number
  }) => Promise<ExperimentAssignmentResolution>
  retrieveProfile?: (input: {
    sessionDigest: string
    profileTokenDigest: string | null
    seedMediaId: string
    locale: string
    audioLanguageSlug: string
    manifestId: string
    deadlineAt: number
    now: Date
  }) => Promise<LiveProfileCandidateResult | null>
  resolveRecentContext?: (input: {
    sessionDigest: string
    profileTokenDigest: string | null
    allowDurableProfileLinks: boolean
    now: Date
    deadlineAt: number
  }) => Promise<RecommendationRecentContext>
  tokenService: DeliveryTokenService | null
  buildCanonicalTarget?: (input: {
    videoSlug: string
    audioLanguageSlug: string
  }) => string
  now?: () => Date
  nowMilliseconds?: () => number
  newId?: () => string
}

export type DeliveryInput = {
  caller: Principal | null
  seedMediaId: string
  locale: string
  audioLanguageSlug: string
  sessionDigest: string
  consentReceiptDigest?: string | null
  profileTokenDigest?: string | null
  eligibleHuman?: boolean
}
