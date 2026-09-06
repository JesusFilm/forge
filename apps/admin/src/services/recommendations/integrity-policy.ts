export const RECOMMENDATION_INTEGRITY_POLICY_VERSION =
  "recommendation-integrity-v1"

export const RECOMMENDATION_PROFILE_CONTRIBUTION_CAP = 2
export const RECOMMENDATION_ANONYMOUS_SUPPORT_FLOOR = 3
export const RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD = 4
export const RECOMMENDATION_CONCENTRATION_SUPPORT_FLOOR = 10
export const RECOMMENDATION_MAX_IDENTITY_CONCENTRATION = 0.5

export type RecommendationEligibilityState =
  | "pending"
  | "eligible"
  | "excluded"
  | "quarantined"

export type RecommendationEligibilityScope =
  | "profile"
  | "aggregate"
  | "experiment"

export type RecommendationIntegrityInput = Readonly<{
  sourceType: "playback_outcome" | "content_action"
  actorClass:
    | "human_anonymous"
    | "human_signed_in"
    | "machine"
    | "internal"
    | "test"
  qualifiedView: boolean
  baseWeight: number
  late: boolean
  replayCount: number
  conflictCount: number
  contributionOrdinal: number
  distinctAnonymousSupport: number
  identityConcentration: number
  superseded?: boolean
  actionClass?: "human_action" | "machine_disposition" | "reported_value"
  actionDetail?: string | null
}>

export type RecommendationIntegrityDecision = Readonly<{
  state: Exclude<RecommendationEligibilityState, "pending">
  reasonCodes: string[]
  eligibleScopes: RecommendationEligibilityScope[]
  contributionWeight: number
}>

const EXCLUDED_ACTORS = new Set(["machine", "internal", "test"])

/**
 * Pure, versioned policy. Viewpoint and action sentiment are intentionally not
 * inputs: negative reported value is evidence, never an abuse feature.
 */
export function decideRecommendationEligibility(
  input: RecommendationIntegrityInput,
): RecommendationIntegrityDecision {
  if (EXCLUDED_ACTORS.has(input.actorClass)) {
    return terminal("excluded", `actor_class_${input.actorClass}`)
  }
  if (input.superseded === true) {
    return terminal("excluded", "superseded_outcome_revision")
  }
  if (input.conflictCount > 0) {
    return terminal("quarantined", "conflicting_evidence")
  }
  if (input.replayCount >= RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD) {
    return terminal("quarantined", "replay_velocity_exceeded")
  }
  if (input.late) return terminal("excluded", "late_evidence")
  if (input.sourceType === "playback_outcome" && input.qualifiedView !== true) {
    return terminal("excluded", "qualified_view_required")
  }
  if (input.contributionOrdinal > RECOMMENDATION_PROFILE_CONTRIBUTION_CAP) {
    return terminal("excluded", "identity_content_contribution_cap")
  }
  if (
    input.actorClass === "human_anonymous" &&
    input.distinctAnonymousSupport >=
      RECOMMENDATION_CONCENTRATION_SUPPORT_FLOOR &&
    input.identityConcentration > RECOMMENDATION_MAX_IDENTITY_CONCENTRATION
  ) {
    return terminal("quarantined", "anonymous_concentration_exceeded")
  }

  const contributionWeight = clampWeight(input.baseWeight)
  if (
    input.actorClass === "human_anonymous" &&
    input.distinctAnonymousSupport < RECOMMENDATION_ANONYMOUS_SUPPORT_FLOOR
  ) {
    return {
      state: "eligible",
      reasonCodes: ["aggregate_distinct_support_pending"],
      eligibleScopes: ["profile"],
      contributionWeight,
    }
  }
  if (input.actorClass === "human_anonymous") {
    return {
      state: "eligible",
      reasonCodes: [],
      eligibleScopes: ["profile", "aggregate"],
      contributionWeight,
    }
  }
  return {
    state: "eligible",
    reasonCodes: [],
    eligibleScopes: ["profile", "aggregate", "experiment"],
    contributionWeight,
  }
}

function terminal(
  state: "excluded" | "quarantined",
  reasonCode: string,
): RecommendationIntegrityDecision {
  return {
    state,
    reasonCodes: [reasonCode],
    eligibleScopes: [],
    contributionWeight: 0,
  }
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}
