import { describe, expect, it } from "vitest"
import {
  RECOMMENDATION_INTEGRITY_POLICY_VERSION,
  decideRecommendationEligibility,
} from "./integrity-policy"

const HUMAN_PLAYBACK = {
  sourceType: "playback_outcome" as const,
  actorClass: "human_anonymous" as const,
  qualifiedView: true,
  baseWeight: 0.82,
  late: false,
  replayCount: 0,
  conflictCount: 0,
  contributionOrdinal: 1,
  distinctAnonymousSupport: 1,
  identityConcentration: 1,
}

describe("recommendation integrity policy", () => {
  it("keeps accepted evidence pending until this policy is explicitly run", () => {
    expect(RECOMMENDATION_INTEGRITY_POLICY_VERSION).toBe(
      "recommendation-integrity-v1",
    )
  })

  it("allows a bounded anonymous playback contribution to its own profile while aggregate support is small", () => {
    expect(decideRecommendationEligibility(HUMAN_PLAYBACK)).toEqual({
      state: "eligible",
      reasonCodes: ["aggregate_distinct_support_pending"],
      eligibleScopes: ["profile"],
      contributionWeight: 0.82,
    })
  })

  it("adds aggregate scope after distinct support but never lets anonymous evidence trigger experiments", () => {
    expect(
      decideRecommendationEligibility({
        ...HUMAN_PLAYBACK,
        distinctAnonymousSupport: 3,
        identityConcentration: 1 / 3,
      }),
    ).toMatchObject({
      state: "eligible",
      reasonCodes: [],
      eligibleScopes: ["profile", "aggregate"],
    })
  })

  it.each(["machine", "internal", "test"] as const)(
    "keeps %s evidence inspectable but excludes it from human learning",
    (actorClass) => {
      expect(
        decideRecommendationEligibility({
          ...HUMAN_PLAYBACK,
          actorClass,
        }),
      ).toEqual({
        state: "excluded",
        reasonCodes: [`actor_class_${actorClass}`],
        eligibleScopes: [],
        contributionWeight: 0,
      })
    },
  )

  it("quarantines conflicts and replay storms instead of silently accepting them", () => {
    expect(
      decideRecommendationEligibility({
        ...HUMAN_PLAYBACK,
        conflictCount: 1,
      }),
    ).toMatchObject({
      state: "quarantined",
      reasonCodes: ["conflicting_evidence"],
    })
    expect(
      decideRecommendationEligibility({
        ...HUMAN_PLAYBACK,
        replayCount: 4,
      }),
    ).toMatchObject({
      state: "quarantined",
      reasonCodes: ["replay_velocity_exceeded"],
    })
  })

  it("excludes late evidence and deterministically caps repeated session/content contributions", () => {
    expect(
      decideRecommendationEligibility({ ...HUMAN_PLAYBACK, late: true }),
    ).toMatchObject({
      state: "excluded",
      reasonCodes: ["late_evidence"],
    })
    expect(
      decideRecommendationEligibility({
        ...HUMAN_PLAYBACK,
        contributionOrdinal: 3,
      }),
    ).toMatchObject({
      state: "excluded",
      reasonCodes: ["identity_content_contribution_cap"],
      contributionWeight: 0,
    })
  })

  it("does not classify negative reported value as abuse", () => {
    expect(
      decideRecommendationEligibility({
        ...HUMAN_PLAYBACK,
        sourceType: "content_action",
        actionClass: "reported_value",
        actionDetail: "not_helpful",
      }),
    ).toMatchObject({
      state: "eligible",
      eligibleScopes: ["profile"],
    })
  })

  it("quarantines concentrated anonymous aggregate evidence", () => {
    expect(
      decideRecommendationEligibility({
        ...HUMAN_PLAYBACK,
        distinctAnonymousSupport: 10,
        identityConcentration: 0.7,
      }),
    ).toMatchObject({
      state: "quarantined",
      reasonCodes: ["anonymous_concentration_exceeded"],
    })
  })
})
