import { describe, expect, it } from "vitest"
import { evaluateExperimentEvidence } from "./policy"

const completeWatermarks = {
  assignment: new Date("2026-08-20T12:00:00.000Z"),
  exposure: new Date("2026-08-20T12:00:00.000Z"),
  outcome: new Date("2026-08-20T12:00:00.000Z"),
  mission: new Date("2026-08-20T12:00:00.000Z"),
  eligibility: new Date("2026-08-20T12:00:00.000Z"),
} as const

describe("evaluateExperimentEvidence", () => {
  it("uses every assignment for ITT and only actual exposures for the secondary view", () => {
    const decision = evaluateExperimentEvidence({
      counts: {
        controlAssigned: 100,
        challengerAssigned: 100,
        controlExposed: 80,
        challengerExposed: 75,
        controlSelections: 20,
        challengerSelections: 20,
        controlQualified: 12,
        challengerQualified: 12,
        controlMission: 4,
        challengerMission: 4,
        controlPlaybackErrors: 1,
        challengerPlaybackErrors: 1,
        contamination: 0,
        conflictingOutcomes: 0,
      },
      expectedChallengerProbability: 0.5,
      watermarks: completeWatermarks,
      windowEnd: new Date("2026-08-20T11:00:00.000Z"),
      policy: { minimumAssignmentsPerArm: 50 },
    })

    expect(decision.state).toBe("pass")
    expect(decision.intentToTreat.control.denominator).toBe(100)
    expect(decision.exposedOnly.control.denominator).toBe(80)
    expect(decision.exposedOnly.challenger.denominator).toBe(75)
  })

  it("marks sample-ratio mismatch and contamination as data unhealthy", () => {
    const mismatch = evaluateExperimentEvidence({
      counts: {
        controlAssigned: 190,
        challengerAssigned: 10,
        controlExposed: 100,
        challengerExposed: 5,
        controlSelections: 0,
        challengerSelections: 0,
        controlQualified: 0,
        challengerQualified: 0,
        controlMission: 0,
        challengerMission: 0,
        controlPlaybackErrors: 0,
        challengerPlaybackErrors: 0,
        contamination: 0,
        conflictingOutcomes: 0,
      },
      expectedChallengerProbability: 0.5,
      watermarks: completeWatermarks,
      windowEnd: new Date("2026-08-20T11:00:00.000Z"),
    })
    expect(mismatch.state).toBe("data_unhealthy")
    expect(mismatch.reasonCodes).toContain("sample_ratio_mismatch")

    const contaminated = evaluateExperimentEvidence({
      counts: {
        controlAssigned: 100,
        challengerAssigned: 100,
        controlExposed: 80,
        challengerExposed: 80,
        controlSelections: 0,
        challengerSelections: 0,
        controlQualified: 0,
        challengerQualified: 0,
        controlMission: 0,
        challengerMission: 0,
        controlPlaybackErrors: 0,
        challengerPlaybackErrors: 0,
        contamination: 1,
        conflictingOutcomes: 0,
      },
      expectedChallengerProbability: 0.5,
      watermarks: completeWatermarks,
      windowEnd: new Date("2026-08-20T11:00:00.000Z"),
    })
    expect(contaminated.state).toBe("data_unhealthy")
    expect(contaminated.reasonCodes).toContain("exposure_contamination")
  })

  it("waits for a closed outcome window and complete ingestion watermarks", () => {
    const decision = evaluateExperimentEvidence({
      counts: {
        controlAssigned: 100,
        challengerAssigned: 100,
        controlExposed: 80,
        challengerExposed: 80,
        controlSelections: 10,
        challengerSelections: 10,
        controlQualified: 5,
        challengerQualified: 5,
        controlMission: 1,
        challengerMission: 1,
        controlPlaybackErrors: 0,
        challengerPlaybackErrors: 0,
        contamination: 0,
        conflictingOutcomes: 0,
      },
      expectedChallengerProbability: 0.5,
      watermarks: { ...completeWatermarks, outcome: null },
      windowEnd: new Date("2026-08-20T13:00:00.000Z"),
      inputCapturedAt: new Date("2026-08-20T12:00:00.000Z"),
    })
    expect(decision.state).toBe("data_unhealthy")
    expect(decision.reasonCodes).toEqual(
      expect.arrayContaining([
        "outcome_window_open",
        "outcome_watermark_missing",
      ]),
    )
  })

  it("fails when the challenger harms a playback guardrail", () => {
    const decision = evaluateExperimentEvidence({
      counts: {
        controlAssigned: 100,
        challengerAssigned: 100,
        controlExposed: 100,
        challengerExposed: 100,
        controlSelections: 20,
        challengerSelections: 30,
        controlQualified: 20,
        challengerQualified: 20,
        controlMission: 4,
        challengerMission: 4,
        controlPlaybackErrors: 1,
        challengerPlaybackErrors: 10,
        contamination: 0,
        conflictingOutcomes: 0,
      },
      expectedChallengerProbability: 0.5,
      watermarks: completeWatermarks,
      windowEnd: new Date("2026-08-20T11:00:00.000Z"),
      policy: { maximumPlaybackErrorRateDelta: 0.05 },
    })
    expect(decision.state).toBe("fail")
    expect(decision.reasonCodes).toContain("playback_error_guardrail_failed")
  })
})
