import { describe, expect, it } from "vitest"
import {
  RECOMMENDATION_CONTROL_READINESS_POLICY,
  evaluateSemanticControlReadiness,
  type SemanticControlEvidence,
} from "./policy"

function healthyEvidence(
  overrides: Partial<SemanticControlEvidence> = {},
): SemanticControlEvidence {
  return {
    issuedRequests: 200,
    servedRequests: 198,
    fallbackRequests: 2,
    servedItems: 1_000,
    impressions: 800,
    selections: 160,
    selectionWithoutImpression: 0,
    matureOutcomes: 120,
    qualifiedViewOutcomes: 42,
    missionQualifiedOutcomes: 8,
    missionOffsetOutcomes: 5,
    rejectedMissionOffsets: 3,
    machineExcluded: 14,
    integrityExcluded: 7,
    classifierLag: 0,
    writeFailures: 0,
    conflicts: 0,
    lateEvidence: 0,
    retrievalP95Ms: 420,
    ...overrides,
  }
}

describe("semantic control readiness policy", () => {
  it("returns inconclusive for low traffic without calling instrumentation unhealthy", () => {
    const decision = evaluateSemanticControlReadiness(
      healthyEvidence({
        issuedRequests: 20,
        servedRequests: 20,
        servedItems: 80,
        impressions: 18,
        selections: 4,
        matureOutcomes: 4,
        qualifiedViewOutcomes: 2,
      }),
    )

    expect(decision.state).toBe("inconclusive")
    expect(decision.dimensions.delivery.state).toBe("inconclusive")
    expect(decision.reasonCodes).toContain("minimum_request_traffic_not_met")
    expect(decision.explanation).toContain("more eligible human traffic")
  })

  it("returns data-unhealthy for an attribution mismatch", () => {
    const decision = evaluateSemanticControlReadiness(
      healthyEvidence({ selectionWithoutImpression: 1 }),
    )

    expect(decision.state).toBe("data-unhealthy")
    expect(decision.dimensions.attribution).toEqual({
      state: "unhealthy",
      reasonCodes: ["selection_without_eligible_impression"],
    })
  })

  it("does not let high CTR override a conclusive qualified-outcome regression", () => {
    const decision = evaluateSemanticControlReadiness(
      healthyEvidence({
        impressions: 200,
        selections: 180,
        matureOutcomes: 100,
        qualifiedViewOutcomes: 0,
        missionQualifiedOutcomes: 0,
        missionOffsetOutcomes: 0,
      }),
    )

    expect(decision.rates.ctr).toBe(0.9)
    expect(decision.dimensions.guardrail.state).toBe("fail")
    expect(decision.state).toBe("not-ready")
    expect(decision.reasonCodes).toContain(
      "qualified_outcome_floor_conclusively_missed",
    )
  })

  it("counts mission offsets only when the declared purpose policy accepted them", () => {
    const accepted = evaluateSemanticControlReadiness(
      healthyEvidence({
        matureOutcomes: 100,
        qualifiedViewOutcomes: 6,
        missionQualifiedOutcomes: 8,
        missionOffsetOutcomes: 8,
        rejectedMissionOffsets: 12,
      }),
    )

    expect(accepted.rates.qualifiedOutcome).toBe(0.14)
    expect(accepted.dimensions.mission).toEqual({
      state: "pass",
      reasonCodes: [
        "declared_purpose_mission_offset_applied",
        "undeclared_mission_offset_excluded",
      ],
    })
    expect(accepted.explanation).toContain(
      RECOMMENDATION_CONTROL_READINESS_POLICY.outcomePolicyVersion,
    )
  })

  it("keeps machine evidence excluded from every human outcome denominator", () => {
    const decision = evaluateSemanticControlReadiness(
      healthyEvidence({ machineExcluded: 999 }),
    )

    expect(decision.state).toBe("ready")
    expect(decision.dimensions.maturity.reasonCodes).toContain(
      "machine_evidence_excluded",
    )
    expect(decision.rates.qualifiedOutcome).toBe(47 / 120)
  })

  it("publishes deterministic Wilson uncertainty intervals", () => {
    const first = evaluateSemanticControlReadiness(healthyEvidence())
    const second = evaluateSemanticControlReadiness(healthyEvidence())

    expect(first).toEqual(second)
    expect(first.uncertainty).toEqual({
      confidenceLevel: 0.95,
      method: "wilson-score-v1",
      ctr: expect.objectContaining({ lower: expect.any(Number) }),
      qualifiedOutcome: expect.objectContaining({ upper: expect.any(Number) }),
    })
  })
})
